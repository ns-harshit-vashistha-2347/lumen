import asyncio
import threading
import time
from functools import lru_cache

from sentence_transformers import CrossEncoder

from src.core.config import settings
from src.core.logging import get_logger
from src.interfaces.base_retriever import RetrievedChunk

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Micro-batching reranker
#
# The old approach used a global threading.Lock around model.predict(). That
# serialized every concurrent request through one predict call — on GPU it
# left the device idle while other requests waited, and on CPU it turned
# into a queue of independent predicts.
#
# What we do now: coalesce concurrent rerank requests into ONE predict call
# per model. Each request submits its (query, chunks) pairs and awaits a
# future; a single worker task drains the queue every RERANK_BATCH_WINDOW
# seconds (or when it hits RERANK_BATCH_SIZE pairs), runs one batched
# predict, and hands each caller back only its own scores. Same total work,
# far less lock contention, and on GPU we actually get real batching.
# ---------------------------------------------------------------------------

_BATCH_WINDOW_S = 0.010   # 10ms: enough to coalesce a burst, invisible to a request
_MAX_PAIRS_PER_BATCH = max(settings.RERANK_BATCH_SIZE * 4, 64)


class _RerankJob:
    __slots__ = ("query", "contents", "future")

    def __init__(self, query: str, contents: list[str], future: "asyncio.Future[list[float]]"):
        self.query = query
        self.contents = contents
        self.future = future


def _pick_device() -> str:
    """Auto-detect the best available device: CUDA > Apple MPS > CPU.
    Respects an explicit RERANK_DEVICE setting when provided."""
    override = (settings.RERANK_DEVICE or "").strip().lower()
    if override in {"cuda", "mps", "cpu"}:
        return override

    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception as e:
        logger.warning(f"Device detection failed, falling back to CPU: {e}")
    return "cpu"


@lru_cache
def _reranker_for(model_name: str) -> CrossEncoder:
    device = _pick_device()
    logger.info(f"Loading reranker model: {model_name} on device={device}")
    t0 = time.time()
    model = CrossEncoder(
        model_name,
        max_length=settings.RERANK_MAX_LENGTH,
        device=device,
        trust_remote_code=True,
    )
    logger.info(f"Reranker model loaded in {time.time() - t0:.1f}s (device={device})")
    return model


def get_reranker(pipeline: str = "doc") -> CrossEncoder:
    if pipeline == "code":
        return _reranker_for(settings.RERANK_MODEL_CODE or settings.RERANK_MODEL)
    return _reranker_for(settings.RERANK_MODEL)


class _RerankerBatcher:
    """One instance per pipeline. Owns a queue + a single background task
    that runs predict() in a threadpool for whichever jobs are pending."""

    def __init__(self, pipeline: str):
        self.pipeline = pipeline
        self._queue: "asyncio.Queue[_RerankJob]" = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    def _ensure_worker(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name=f"rerank-batcher:{self.pipeline}")

    async def submit(self, query: str, contents: list[str]) -> list[float]:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[list[float]] = loop.create_future()
        await self._queue.put(_RerankJob(query, contents, fut))
        self._ensure_worker()
        return await fut

    async def _run(self) -> None:
        while True:
            try:
                first = await asyncio.wait_for(self._queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                # Idle: let the task die so we don't hold a reference forever.
                return
            batch: list[_RerankJob] = [first]
            pair_count = len(first.contents)
            # Collect anything else that landed within the coalesce window.
            deadline = asyncio.get_running_loop().time() + _BATCH_WINDOW_S
            while pair_count < _MAX_PAIRS_PER_BATCH:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break
                try:
                    job = await asyncio.wait_for(self._queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                batch.append(job)
                pair_count += len(job.contents)

            try:
                await asyncio.to_thread(_run_batch, self.pipeline, batch)
            except Exception as exc:
                logger.exception(f"[rerank-batcher:{self.pipeline}] predict failed: {exc}")
                for job in batch:
                    if not job.future.done():
                        job.future.set_exception(exc)


_BATCHERS: dict[str, _RerankerBatcher] = {}


def _batcher_for(pipeline: str) -> _RerankerBatcher:
    b = _BATCHERS.get(pipeline)
    if b is None:
        b = _RerankerBatcher(pipeline)
        _BATCHERS[pipeline] = b
    return b


def _run_batch(pipeline: str, batch: list[_RerankJob]) -> None:
    """Runs in a worker thread. Combines every job's pairs into a single
    predict() call, then hands each job back a slice of the score array."""
    model = get_reranker(pipeline=pipeline)
    pairs: list[tuple[str, str]] = []
    spans: list[tuple[int, int]] = []
    for job in batch:
        start = len(pairs)
        for content in job.contents:
            pairs.append((job.query, content))
        spans.append((start, len(pairs)))
    if not pairs:
        return
    t0 = time.time()
    scores = model.predict(
        pairs,
        batch_size=settings.RERANK_BATCH_SIZE,
        show_progress_bar=False,
    )
    logger.info(
        f"[rerank] batched {len(batch)} job(s) / {len(pairs)} pairs "
        f"in {time.time() - t0:.2f}s (pipeline={pipeline})"
    )
    # Deliver per-job slices. Each future carries its own loop reference,
    # and call_soon_threadsafe is the safe way to fulfill from a thread.
    for job, (start, end) in zip(batch, spans):
        job_scores = [float(s) for s in scores[start:end]]
        if not job.future.done():
            job.future.get_loop().call_soon_threadsafe(job.future.set_result, job_scores)


async def _rerank_async(query: str, chunks: list[RetrievedChunk], top_n: int, pipeline: str = "doc") -> list[RetrievedChunk]:
    contents = [c.content for c in chunks]
    scores = await _batcher_for(pipeline).submit(query, contents)
    reranked = sorted(zip(chunks, scores), key=lambda pair: pair[1], reverse=True)[:top_n]
    return [
        RetrievedChunk(
            id=chunk.id, content=chunk.content, metadata=chunk.metadata, score=float(score),
        )
        for chunk, score in reranked
    ]


def rerank(query: str, chunks: list[RetrievedChunk], top_n: int, pipeline: str = "doc") -> list[RetrievedChunk]:
    """Sync entrypoint kept for tests / non-async callers. Skips the batcher
    (batching only helps under concurrent load)."""
    if not chunks:
        return []
    model = get_reranker(pipeline=pipeline)
    pairs = [(query, c.content) for c in chunks]
    scores = model.predict(pairs, batch_size=settings.RERANK_BATCH_SIZE, show_progress_bar=False)
    reranked = sorted(zip(chunks, scores), key=lambda pair: pair[1], reverse=True)[:top_n]
    return [
        RetrievedChunk(id=c.id, content=c.content, metadata=c.metadata, score=float(s))
        for c, s in reranked
    ]


async def rerank_node(state: dict) -> dict:
    if not settings.RERANK_ENABLED:
        top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)
        return {"reranked_results": state.get("fused_results", [])[:top_k]}

    query = state.get("primary_query") or state["query"]
    fused_results = state.get("fused_results", [])
    top_n = state.get("top_k", settings.RERANK_TOP_N)
    pipeline = state.get("pipeline", "doc")

    if not fused_results:
        return {"reranked_results": []}

    # Cheap short-circuit: if fusion already returned ≤ top_n candidates,
    # reranking can only permute them — no chunks get filtered out and the
    # LLM sees the same set either way. Skip the 200-800ms CPU cost.
    if len(fused_results) <= top_n:
        logger.info(
            f"[rerank_node] skipped: {len(fused_results)} candidates ≤ top_n={top_n} pipeline={pipeline}"
        )
        return {"reranked_results": fused_results}

    logger.info(
        f"[rerank_node] reranking {len(fused_results)} candidates -> top_n={top_n} pipeline={pipeline}"
    )

    # Micro-batcher coalesces concurrent rerank submissions into one
    # predict() call and streams per-job scores back on the event loop.
    reranked = await _rerank_async(query, fused_results, top_n, pipeline)

    return {"reranked_results": reranked}

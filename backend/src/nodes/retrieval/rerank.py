import asyncio
import threading
import time
from functools import lru_cache

from sentence_transformers import CrossEncoder

from src.core.config import settings
from src.core.logging import get_logger
from src.interfaces.base_retriever import RetrievedChunk

logger = get_logger(__name__)

_RERANK_LOCK = threading.Lock()


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


def _rerank_sync(query: str, chunks: list[RetrievedChunk], top_n: int, pipeline: str = "doc") -> list[RetrievedChunk]:
    model = get_reranker(pipeline=pipeline)
    pairs = [(query, chunk.content) for chunk in chunks]
    t0 = time.time()
    # Serialize predict() calls: the model is not thread-safe and running
    # multiple predicts concurrently on CPU thrashes rather than parallelizes.
    with _RERANK_LOCK:
        scores = model.predict(
            pairs,
            batch_size=settings.RERANK_BATCH_SIZE,
            show_progress_bar=False,
        )
    logger.info(f"[rerank] scored {len(pairs)} pairs in {time.time() - t0:.2f}s")

    reranked = sorted(
        zip(chunks, scores),
        key=lambda pair: pair[1],
        reverse=True,
    )[:top_n]

    return [
        RetrievedChunk(
            id=chunk.id,
            content=chunk.content,
            metadata=chunk.metadata,
            score=float(score),
        )
        for chunk, score in reranked
    ]


def rerank(query: str, chunks: list[RetrievedChunk], top_n: int, pipeline: str = "doc") -> list[RetrievedChunk]:
    if not chunks:
        return []
    return _rerank_sync(query, chunks, top_n, pipeline)


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

    # Run the blocking CPU work in a threadpool so the event loop stays
    # free to service other users' requests during rerank.
    reranked = await asyncio.to_thread(_rerank_sync, query, fused_results, top_n, pipeline)

    return {"reranked_results": reranked}

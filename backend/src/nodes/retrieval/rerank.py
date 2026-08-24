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
def get_reranker() -> CrossEncoder:
    device = _pick_device()
    logger.info(f"Loading reranker model: {settings.RERANK_MODEL} on device={device}")
    t0 = time.time()
    model = CrossEncoder(
        settings.RERANK_MODEL,
        max_length=settings.RERANK_MAX_LENGTH,
        device=device,
    )
    logger.info(f"Reranker model loaded in {time.time() - t0:.1f}s (device={device})")
    return model


def _rerank_sync(query: str, chunks: list[RetrievedChunk], top_n: int) -> list[RetrievedChunk]:
    model = get_reranker()
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


def rerank(query: str, chunks: list[RetrievedChunk], top_n: int) -> list[RetrievedChunk]:
    if not chunks:
        return []
    return _rerank_sync(query, chunks, top_n)


async def rerank_node(state: dict) -> dict:
    if not settings.RERANK_ENABLED:
        top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)
        return {"reranked_results": state.get("fused_results", [])[:top_k]}

    query = state.get("primary_query") or state["query"]
    fused_results = state.get("fused_results", [])
    top_n = state.get("top_k", settings.RERANK_TOP_N)

    logger.info(
        f"[rerank_node] reranking {len(fused_results)} candidates -> top_n={top_n}"
    )

    if not fused_results:
        return {"reranked_results": []}

    # Run the blocking CPU work in a threadpool so the event loop stays
    # free to service other users' requests during rerank.
    reranked = await asyncio.to_thread(_rerank_sync, query, fused_results, top_n)

    return {"reranked_results": reranked}

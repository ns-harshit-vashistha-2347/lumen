from functools import lru_cache

try:
    from langchain_huggingface import HuggingFaceEmbeddings  # type: ignore
except ImportError:  # fallback until langchain-huggingface is installed
    from langchain_community.embeddings import HuggingFaceEmbeddings

from src.core.config import settings
from src.core.logging import get_logger
from src.interfaces.base_embedder import BaseEmbedder


logger = get_logger(__name__)


def _pick_device() -> str:
    """Auto-detect the best available device: CUDA > Apple MPS > CPU.
    Respects an explicit EMBEDDING_DEVICE setting when provided."""
    override = (settings.EMBEDDING_DEVICE or "").strip().lower()
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


class HFEmbedder(BaseEmbedder):
    def __init__(self, model_name: str | None = None):
        device = _pick_device()
        resolved = model_name or settings.EMBEDDING_MODEL
        logger.info(f"Loading embedder: {resolved} on device={device}")
        self.model_name = resolved
        self.model = HuggingFaceEmbeddings(
            model_name=resolved,
            model_kwargs={"device": device, "trust_remote_code": True},
            encode_kwargs={"batch_size": settings.EMBEDDING_BATCH_SIZE, "normalize_embeddings": True},
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.model.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        # Redis-backed cache keyed on (model, text). Same query embedded twice
        # in a request (primary + rewrites) or across requests (retries,
        # pagination) skips the tokenizer+forward pass entirely.
        from src.core.cache import get_cached_embedding, set_cached_embedding
        cached = get_cached_embedding(self.model_name, text)
        if cached is not None:
            return cached
        vec = self.model.embed_query(text)
        set_cached_embedding(self.model_name, text, vec)
        return vec


@lru_cache
def _embedder_for(model_name: str) -> BaseEmbedder:
    return HFEmbedder(model_name=model_name)


def get_embedder(pipeline: str = "doc") -> BaseEmbedder:
    """Return an embedder for the given pipeline.

    pipeline='doc' -> settings.EMBEDDING_MODEL (general prose / mixed content).
    pipeline='code' -> settings.EMBEDDING_MODEL_CODE (code-tuned).
    """
    if pipeline == "code":
        return _embedder_for(settings.EMBEDDING_MODEL_CODE or settings.EMBEDDING_MODEL)
    return _embedder_for(settings.EMBEDDING_MODEL)


def embed_node(state: dict) -> dict:
    chunks = state["chunks"]
    logger.info(f"Embedding {len(chunks)} chunks")

    embedder = get_embedder(pipeline="doc")
    texts = [chunk.content for chunk in chunks]
    embeddings = embedder.embed_documents(texts)

    return {**state, "embeddings": embeddings}

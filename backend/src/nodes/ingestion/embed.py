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
        logger.info(
            f"Loading embedder: {model_name or settings.EMBEDDING_MODEL} on device={device}"
        )
        self.model = HuggingFaceEmbeddings(
            model_name=model_name or settings.EMBEDDING_MODEL,
            model_kwargs={"device": device},
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.model.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        return self.model.embed_query(text)


@lru_cache
def get_embedder() -> BaseEmbedder:
    return HFEmbedder()


def embed_node(state: dict) -> dict:
    chunks = state["chunks"]
    logger.info(f"Embedding {len(chunks)} chunks")

    embedder = get_embedder()
    texts = [chunk.content for chunk in chunks]
    embeddings = embedder.embed_documents(texts)

    return {**state, "embeddings": embeddings}

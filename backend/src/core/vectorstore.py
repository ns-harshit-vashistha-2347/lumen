from functools import lru_cache

import chromadb

from src.core.config import settings


@lru_cache()
def get_chroma_client():
    """HTTP client for local docker-compose, PersistentClient for
    single-container deployments (e.g. Hugging Face Spaces)."""
    if settings.CHROMA_MODE == "embedded":
        return chromadb.PersistentClient(path=settings.CHROMA_PERSIST_PATH)
    return chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)


@lru_cache()
def _get_collection_cached(name: str):
    client = get_chroma_client()
    return client.get_or_create_collection(name)


def get_collections(name: str | None = None):
    return _get_collection_cached(name or settings.CHROMA_COLLECTION_DOCUMENTS)

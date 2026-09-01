"""Embed CodeChunks. Reuses the existing HFEmbedder from ingestion/embed.py
so we keep a single vector space per deployment."""
from __future__ import annotations

from src.core.logging import get_logger
from src.nodes.ingestion.embed import get_embedder

logger = get_logger(__name__)


def code_embed_node(state: dict) -> dict:
    chunks = state["chunks"]
    if not chunks:
        return {"embeddings": []}
    embedder = get_embedder(pipeline="code")
    texts = [c.content for c in chunks]
    embeddings = embedder.embed_documents(texts)
    logger.info(f"[code_embed] embedded {len(chunks)} chunks with {embedder.model_name}")
    return {"embeddings": embeddings}
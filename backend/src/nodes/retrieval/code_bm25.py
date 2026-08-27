"""BM25 over a per-repo Chroma collection with identifier-aware tokenization.

Code queries hit words that dense embeddings often miss — exact function
names ("ingest_repo_task"), error strings, file paths, config keys. This
node runs sparse retrieval on the same corpus as `code_dense_node` and its
results get fused with dense.

Tokenization strategy:
  - Preserve the original token AND its split parts, so both
    "ingest_repo_task" and "ingest" / "repo" / "task" score against a
    query using either form.
  - Split on snake_case AND CamelCase boundaries.
  - Keep dotted paths like "src.tasks.foo" as-is *and* as parts.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from rank_bm25 import BM25Okapi

from src.core.cache import get_bm25_version
from src.core.config import settings
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.interfaces.base_retriever import BaseRetriever, RetrievedChunk
from src.nodes.retrieval.fusion import reciprocal_rank_fusion

logger = get_logger(__name__)

_CODE_BM25_CACHE: dict[str, tuple] = {}

_SPLIT_RE = re.compile(r"[^A-Za-z0-9_.]+")
_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_STOPWORDS = {"the", "a", "an", "is", "are", "of", "to", "in", "and", "or", "for", "on", "at"}


def _explode(token: str) -> list[str]:
    """Expand one raw token into its indexable variants."""
    out: list[str] = [token]
    # snake_case parts
    if "_" in token:
        out.extend(p for p in token.split("_") if p)
    # dotted paths
    if "." in token:
        out.extend(p for p in token.split(".") if p)
    # CamelCase parts
    camel_parts = _CAMEL_RE.split(token)
    if len(camel_parts) > 1:
        out.extend(camel_parts)
    return out


def _tokenize_code(text: str) -> list[str]:
    if not text:
        return []
    parts = _SPLIT_RE.split(text)
    tokens: list[str] = []
    for raw in parts:
        if not raw:
            continue
        for variant in _explode(raw):
            v = variant.lower()
            if len(v) < 2 or v in _STOPWORDS:
                continue
            tokens.append(v)
    return tokens


class CodeBM25Retriever(BaseRetriever):
    def __init__(self, collection_name: str):
        self.collection = get_collections(collection_name)

    def _load_corpus(self):
        data = self.collection.get(include=["metadatas", "documents"])
        return data.get("ids", []), data.get("documents", []), data.get("metadatas", [])

    def _get_index(self):
        name = self.collection.name
        version = get_bm25_version(name)
        cached = _CODE_BM25_CACHE.get(name)
        if cached is not None:
            cached_version, built_at, bm25, ids, docs, metas = cached
            fresh = (time.time() - built_at) < settings.BM25_CACHE_TTL_SECONDS
            if cached_version == version:
                if not fresh:
                    _CODE_BM25_CACHE[name] = (cached_version, time.time(), bm25, ids, docs, metas)
                return bm25, ids, docs, metas
        logger.info(f"[CodeBM25Retriever] rebuilding index for '{name}' (version={version})")
        ids, docs, metas = self._load_corpus()
        bm25 = BM25Okapi([_tokenize_code(d) for d in docs]) if docs else None
        _CODE_BM25_CACHE[name] = (version, time.time(), bm25, ids, docs, metas)
        return bm25, ids, docs, metas

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        user_id: str | None = None,
        document_ids: list[str] | None = None,
        focus_files: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        bm25, ids, docs, metas = self._get_index()
        if not docs or bm25 is None:
            return []

        scores = bm25.get_scores(_tokenize_code(query))
        combined: list[tuple[str, str, dict, float]] = list(zip(ids, docs, metas, scores))

        if focus_files:
            allow_files = set(focus_files)
            combined = [row for row in combined if (row[2] or {}).get("path") in allow_files]

        ranked = sorted(combined, key=lambda x: x[3], reverse=True)[:top_k]
        return [
            RetrievedChunk(id=cid, content=doc, metadata=meta, score=float(score))
            for cid, doc, meta, score in ranked
        ]


def _repo_collection(repo_id: str) -> str:
    return f"{settings.REPO_COLLECTION_PREFIX}{repo_id.replace('-', '')}"


async def code_bm25_node(state: dict) -> dict:
    """Node parallel to `code_dense_node`. Runs the same `queries` variants
    through BM25 against the per-repo collection, RRF-fuses across variants,
    and returns `code_bm25_results`."""
    repo_id = state["repo_id"]
    queries = state.get("queries") or [state.get("primary_query") or state["query"]]
    top_k = state.get("top_k", settings.CODE_QUERY_TOP_K)
    focus_files = state.get("focus_files") or None

    retriever = CodeBM25Retriever(_repo_collection(repo_id))

    per_query = await asyncio.gather(*[
        asyncio.to_thread(retriever.retrieve, q, top_k, None, None, focus_files)
        for q in queries
    ])
    fused = reciprocal_rank_fusion(per_query)[:top_k]

    logger.info(
        f"[code_bm25] repo={repo_id} queries={len(queries)} focus_files={len(focus_files or [])} "
        f"→ {len(fused)} hits"
    )
    return {"code_bm25_results": fused}


def code_fusion_node(state: dict) -> dict:
    """Combine `dense_results` (from `code_dense_node`) with `code_bm25_results`
    via weighted RRF. Written back into `dense_results` so downstream
    generation/streaming code keeps working unchanged."""
    from src.nodes.retrieval.fusion import weighted_rrf

    dense: list[Any] = state.get("dense_results") or []
    bm25: list[Any] = state.get("code_bm25_results") or []
    top_k = state.get("top_k", settings.CODE_QUERY_TOP_K)
    query = state.get("primary_query") or state.get("query", "")

    if not dense and not bm25:
        return {"dense_results": []}
    if not bm25:
        return {"dense_results": dense[:top_k]}
    if not dense:
        return {"dense_results": bm25[:top_k]}

    fused = weighted_rrf(dense, bm25, query)[:top_k]
    logger.info(f"[code_fusion] dense={len(dense)} bm25={len(bm25)} → {len(fused)}")
    return {"dense_results": fused, "reranked_results": fused}

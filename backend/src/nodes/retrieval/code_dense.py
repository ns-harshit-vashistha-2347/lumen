"""Dense retrieval against a per-repo Chroma collection.

Reuses the existing embedder. If state['focus_files'] is non-empty (populated
by graph_query_node), we bias the search with a metadata filter so results
from those files are preferred; we still run an unfiltered search as a
fallback and merge.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.core.config import settings
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.nodes.ingestion.embed import get_embedder
from src.interfaces.base_retriever import RetrievedChunk

logger = get_logger(__name__)


def _collection_for(repo_id: str) -> Any:
    return get_collections(f"{settings.REPO_COLLECTION_PREFIX}{repo_id.replace('-', '')}")


def _rows_to_chunks(res) -> list[RetrievedChunk]:
    if not res or not res.get("ids") or not res["ids"][0]:
        return []
    ids = res["ids"][0]
    docs = res["documents"][0]
    metas = res["metadatas"][0]
    dists = res.get("distances", [[]])[0] or [0.0] * len(ids)
    out = []
    for i, doc, meta, dist in zip(ids, docs, metas, dists):
        # Chroma cosine distance in [0, 2]; convert to score in (~-1, 1]
        score = 1.0 - float(dist)
        out.append(RetrievedChunk(id=i, content=doc, metadata=meta or {}, score=score))
    return out


def code_dense_node(state: dict) -> dict:
    repo_id: str = state["repo_id"]
    queries = state.get("queries") or [state.get("primary_query") or state["query"]]
    top_k = state.get("top_k", settings.CODE_QUERY_TOP_K)

    embedder = get_embedder()
    coll = _collection_for(repo_id)
    focus_files: list[str] = state.get("focus_files") or []

    results: list[RetrievedChunk] = []
    for query in queries:
        q_emb = embedder.embed_query(query)
        if focus_files:
            try:
                filtered = coll.query(
                    query_embeddings=[q_emb],
                    n_results=top_k,
                    where={"path": {"$in": focus_files}},
                )
                results.extend(_rows_to_chunks(filtered))
            except Exception as exc:
                logger.warning(f"[code_dense] filtered query failed: {exc}")
        # Always run an unfiltered pass so we don't miss context outside
        # the graph's opinion.
        unfiltered = coll.query(query_embeddings=[q_emb], n_results=top_k)
        results.extend(_rows_to_chunks(unfiltered))

    # De-dupe by chunk id, keep highest score
    dedup: dict[str, RetrievedChunk] = {}
    for c in results:
        if c.id not in dedup or c.score > dedup[c.id].score:
            dedup[c.id] = c
    final = sorted(dedup.values(), key=lambda c: c.score, reverse=True)[:top_k]

    logger.info(
        f"[code_dense] repo={repo_id} queries={len(queries)} returned {len(final)} chunks (top_k={top_k})"
    )
    return {"dense_results": final, "reranked_results": final}
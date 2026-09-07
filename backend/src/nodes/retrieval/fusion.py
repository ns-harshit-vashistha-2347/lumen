from src.core.config import settings
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.interfaces.base_retriever import RetrievedChunk
import re

logger = get_logger(__name__)

def _bm25_weight_for_query(query: str) -> float:
    """Favor BM25 for queries with quoted phrases, codes, numbers, or acronyms —
    they need exact term matches more than semantic similarity."""
    if re.search(r'"[^"]+"|\b[A-Z]{2,}\b|\b\d+\b', query):
        return 0.65
    return 0.5


def weighted_rrf(dense: list, bm25: list, query: str, k: int | None = None) -> list[RetrievedChunk]:
    rrf_k = k or settings.RRF_K
    bm25_w = _bm25_weight_for_query(query)
    dense_w = 1 - bm25_w

    scores, lookup = {}, {}
    for weight, results in [(dense_w, dense), (bm25_w, bm25)]:
        for rank, chunk in enumerate(results):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + weight / (rrf_k + rank + 1)
            lookup.setdefault(chunk.id, chunk)

    ranked_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [RetrievedChunk(id=cid, content=lookup[cid].content, metadata=lookup[cid].metadata, score=scores[cid]) for cid in ranked_ids]

def reciprocal_rank_fusion(
    result_lists: list[list[RetrievedChunk]], k: int | None = None
) -> list[RetrievedChunk]:
    rrf_k = k or settings.RRF_K
    scores: dict[str, float] = {}
    chunk_lookup: dict[str, RetrievedChunk] = {}

    for results in result_lists:
        for rank, chunk in enumerate(results):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + 1.0 / (rrf_k + rank + 1)
            chunk_lookup.setdefault(chunk.id, chunk)

    ranked_ids = sorted(scores.keys(), key=lambda cid: scores[cid], reverse=True)

    fused = []
    for cid in ranked_ids:
        chunk = chunk_lookup[cid]
        fused.append(
            RetrievedChunk(
                id=chunk.id,
                content=chunk.content,
                metadata=chunk.metadata,
                score=scores[cid], 
            )
        )
    return fused


# How many leading chunks per scoped doc to force-include as a "preamble".
# The first chunks of a doc almost always carry the title, purpose, and
# section headings — which is exactly what meta questions like "what is
# this document about?" need, and what similarity search misses because
# such queries have no lexical overlap with the doc body.
_SCOPE_PREAMBLE_PER_DOC = 2
# Cap the total preamble injection so a large scope doesn't crowd the
# retrieved-by-similarity chunks out of the pool.
_SCOPE_PREAMBLE_MAX_TOTAL = 6


def _fetch_scope_preamble(
    document_ids: list[str], user_id: str | None = None
) -> list[RetrievedChunk]:
    """Fetch the earliest chunks (chunk_index low) of each scoped doc from
    Chroma. Returns [] if no docs, if the collection call fails, or if the
    scope is too large to bother — retrieval-by-similarity handles those
    cases fine on its own. The user_id filter matches the tenant-scoping
    every other retriever uses so a leaked doc_id can't pull another
    tenant's chunks."""
    if not document_ids:
        return []
    # For big scopes the preamble would either dwarf or duplicate the
    # similarity results; skip it and let normal retrieval do its job.
    if len(document_ids) > _SCOPE_PREAMBLE_MAX_TOTAL:
        return []
    try:
        collection = get_collections(settings.CHROMA_COLLECTION_DOCUMENTS)
        conditions: list[dict] = []
        if user_id:
            conditions.append({"user_id": user_id})
        if len(document_ids) == 1:
            conditions.append({"document_id": document_ids[0]})
        else:
            conditions.append({"document_id": {"$in": document_ids}})
        where = (
            {"$and": conditions} if len(conditions) > 1 else conditions[0]
        )
        data = collection.get(
            where=where,
            include=["documents", "metadatas"],
            # Cap to keep this cheap: even with the max scope, this pulls
            # at most ~ scope_size * a-few-per-doc chunks after ordering.
            limit=len(document_ids) * (_SCOPE_PREAMBLE_PER_DOC + 4),
        )
    except Exception as exc:  # noqa: BLE001 — chroma raises many types
        logger.warning(f"[fusion] scope preamble fetch failed: {exc}")
        return []

    ids = data.get("ids", []) or []
    docs = data.get("documents", []) or []
    metas = data.get("metadatas", []) or []

    # Group by document_id and keep the lowest chunk_index rows per doc.
    by_doc: dict[str, list[tuple[int, str, str, dict]]] = {}
    for cid, content, meta in zip(ids, docs, metas):
        m = meta or {}
        did = m.get("document_id")
        if not did:
            continue
        idx = int(m.get("chunk_index") or 0)
        by_doc.setdefault(did, []).append((idx, cid, content, m))

    preamble: list[RetrievedChunk] = []
    for did in document_ids:
        rows = sorted(by_doc.get(did, []), key=lambda r: r[0])
        for _idx, cid, content, m in rows[:_SCOPE_PREAMBLE_PER_DOC]:
            preamble.append(
                RetrievedChunk(
                    id=cid,
                    content=content,
                    metadata=m,
                    # Small but non-zero score so it sits at the top of the
                    # fused pool before rerank without dominating scoring.
                    score=1.0,
                )
            )
        if len(preamble) >= _SCOPE_PREAMBLE_MAX_TOTAL:
            break
    return preamble[:_SCOPE_PREAMBLE_MAX_TOTAL]


def fusion_node(state: dict) -> dict:
    dense_results = state.get("dense_results", [])
    bm25_results = state.get("bm25_results", [])
    pool_size = state.get("retrieval_k", state.get("top_k", 5))
    query = state.get("primary_query") or state.get("query", "")

    fused = weighted_rrf(dense_results, bm25_results, query)

    # Scope preamble: for questions like "what is this document about?" the
    # similarity search returns policy-clauses whose text never says "this
    # document is X", so the LLM correctly refuses. Force-include a couple
    # of leading chunks per scoped doc so the answer path always has the
    # doc's title/purpose/section headings to work with.
    document_ids = state.get("document_ids") or []
    preamble = _fetch_scope_preamble(document_ids, state.get("user_id"))
    if preamble:
        seen = {c.id for c in preamble}
        fused = preamble + [c for c in fused if c.id not in seen]

    fused = fused[:pool_size]

    logger.info(
        f"[fusion_node] dense={len(dense_results)} bm25={len(bm25_results)} "
        f"preamble={len(preamble)} -> fused={len(fused)}"
    )
    return {"fused_results": fused}

"""Write code chunks + embeddings into a per-repo Chroma collection,
and record per-file metadata in Postgres."""
from __future__ import annotations

import uuid
from collections import defaultdict

from src.core.cache import bump_bm25_version
from src.core.config import settings
from src.core.logging import get_logger
from src.core.sync_db import get_sync_db
from src.core.vectorstore import get_collections
from src.models.repo import RepoFile

logger = get_logger(__name__)


def _collection_name(repo_id: str) -> str:
    return f"{settings.REPO_COLLECTION_PREFIX}{repo_id.replace('-', '')}"


def code_store_node(state: dict) -> dict:
    repo_id: str = state["repo_id"]
    chunks = state["chunks"]
    embeddings = state["embeddings"]
    head_sha: str | None = state.get("head_sha")

    if not chunks:
        return {"stored_chunk_count": 0}

    from src.core.vectorstore import get_chroma_client
    coll_name = _collection_name(repo_id)
    collection = get_collections(coll_name)

    # If the collection was previously populated with a different-dimension
    # embedder (e.g. user switched EMBEDDING_MODEL_CODE), drop and recreate
    # so Chroma doesn't reject the upsert with a shape mismatch.
    new_dim = len(embeddings[0]) if embeddings else 0
    try:
        peek = collection.peek(limit=1)
        existing = (peek.get("embeddings") or [None])[0]
        if existing is not None and len(existing) != new_dim:
            logger.warning(
                f"[code_store] embedding dim changed for {coll_name} "
                f"({len(existing)} -> {new_dim}); recreating collection"
            )
            get_chroma_client().delete_collection(coll_name)
            # Bust the lru_cache in vectorstore so we don't hand out the
            # deleted collection object.
            from src.core.vectorstore import _get_collection_cached
            _get_collection_cached.cache_clear()
            collection = get_collections(coll_name)
    except Exception as exc:
        logger.warning(f"[code_store] dim-check skipped for {coll_name}: {exc}")

    # Full ingest re-generates chunk ids each run; wipe prior chunks
    # so refresh does not accumulate duplicates alongside the new set.
    try:
        collection.delete(where={"repo_id": repo_id})
    except Exception as exc:
        logger.warning(f"[code_store] pre-wipe failed for {repo_id}: {exc}")

    ids, docs, metas, embs = [], [], [], []
    per_file_counts: dict[str, int] = defaultdict(int)

    for chunk, emb in zip(chunks, embeddings):
        cid = str(uuid.uuid4())
        ids.append(cid)
        docs.append(chunk.content)
        metas.append({
            "repo_id": repo_id,
            "path": chunk.rel_path,
            "language": chunk.language,
            "symbol_name": chunk.symbol_name or "",
            "symbol_kind": chunk.symbol_kind or "",
            "start_line": chunk.start_line,
            "end_line": chunk.end_line,
            "source": chunk.rel_path,
            "sha": head_sha or "",
        })
        embs.append(emb)
        per_file_counts[chunk.rel_path] += 1

    # Chroma upsert in reasonable batches
    BATCH = 256
    for i in range(0, len(ids), BATCH):
        collection.upsert(
            ids=ids[i:i+BATCH],
            documents=docs[i:i+BATCH],
            metadatas=metas[i:i+BATCH],
            embeddings=embs[i:i+BATCH],
        )

    # Update RepoFile rows (upsert per path)
    db = get_sync_db()
    try:
        # Purge and rewrite file rows for simplicity on refresh
        db.query(RepoFile).filter(RepoFile.repo_id == repo_id).delete()
        for fe in state["files"]:
            db.add(RepoFile(
                repo_id=repo_id,
                path=fe.rel_path,
                language=fe.language,
                size_bytes=fe.size,
                sha=head_sha,
                chunk_count=per_file_counts.get(fe.rel_path, 0),
            ))
        db.commit()
    finally:
        db.close()

    # Invalidate the per-repo BM25 index so the next code_bm25_node call
    # rebuilds against this fresh corpus instead of the stale cache.
    try:
        bump_bm25_version(_collection_name(repo_id))
    except Exception as exc:
        logger.warning(f"[code_store] failed to bump BM25 version: {exc}")

    logger.info(f"[code_store] repo={repo_id} stored {len(ids)} chunks in {_collection_name(repo_id)}")
    return {"stored_chunk_count": len(ids)}
from __future__ import annotations

from pathlib import Path

from src.celery_app import celery_app
from src.core.config import settings
from src.core.crypto import decrypt_token
from src.core.github_client import (
    GitHubRepoRef, RepoCloneError, clone_repo, parse_github_url, remove_clone, walk_repo,
)
from src.core.logging import get_logger
from src.core.sync_db import get_sync_db
from src.graphs.code_ingestion_graph import code_ingestion_graph
from src.models.repo import Repo, RepoStatus

logger = get_logger(__name__)


def _set_status(repo_id: str, status: RepoStatus, *, error: str | None = None, **fields) -> None:
    db = get_sync_db()
    try:
        repo = db.get(Repo, repo_id)
        if not repo:
            logger.warning(f"[code_ingest] repo {repo_id} vanished while updating status")
            return
        repo.status = status
        if error is not None:
            repo.error_message = error
        for k, v in fields.items():
            setattr(repo, k, v)
        db.commit()
    finally:
        db.close()

from src.core.github_client import diff_paths, unshallow
from src.core.vectorstore import get_collections
from src.core.config import settings


@celery_app.task(bind=True, name="reindex_repo_task", max_retries=2, default_retry_delay=60, acks_late=True)
def reindex_repo_task(self, repo_id: str, new_sha: str | None = None):
    """Incremental re-index: clone at HEAD, diff against repo.last_indexed_sha,
    re-embed only changed files, purge chunks/graph edges for removed files."""
    from src.graphs.code_ingestion_graph import code_ingestion_graph
    from src.core.crypto import decrypt_token
    from src.core.github_client import GitHubRepoRef, clone_repo, remove_clone, walk_repo
    from src.nodes.ingestion.code_parse import parse_file
    from src.nodes.ingestion.embed import get_embedder

    db = get_sync_db()
    try:
        repo = db.get(Repo, repo_id)
        if not repo or not repo.last_indexed_sha:
            logger.info(f"[reindex] repo {repo_id} has no prior sha; running full ingest")
            return ingest_repo_task.apply(args=[repo_id]).get(disable_sync_subtasks=False)
        prior_sha = repo.last_indexed_sha
        token = decrypt_token(repo.encrypted_token) if repo.encrypted_token else None
        ref = GitHubRepoRef(owner=repo.owner, name=repo.name, clone_url=repo.clone_url)
    finally:
        db.close()

    clone_dest = Path(settings.REPO_CLONE_DIR) / f"{repo_id}_reindex"
    try:
        remove_clone(clone_dest)
        head_sha = clone_repo(ref, clone_dest, token=token, depth=1)
        if new_sha and new_sha != head_sha:
            logger.info(f"[reindex] webhook sha {new_sha[:7]} != HEAD {head_sha[:7]}; using HEAD")

        # Deepen so we can diff against prior sha
        unshallow(clone_dest)
        try:
            changed, removed = diff_paths(clone_dest, prior_sha, head_sha)
        except Exception as exc:
            logger.warning(f"[reindex] diff failed ({exc}); falling back to full re-ingest")
            _set_status(repo_id, RepoStatus.PENDING)
            ingest_repo_task.delay(repo_id)
            return

        if not changed and not removed:
            _set_status(repo_id, RepoStatus.COMPLETED, last_indexed_sha=head_sha)
            return {"status": "no_change"}

        # Filter changed to indexable subset
        all_files = walk_repo(clone_dest)
        by_path = {f.rel_path: f for f in all_files}
        changed_entries = [by_path[p] for p in changed if p in by_path]

        collection = get_collections(repo.collection_name)

        # Purge removed + changed from Chroma (metadata filter on path)
        purge_paths = set(removed) | {f.rel_path for f in changed_entries}
        if purge_paths:
            collection.delete(where={"path": {"$in": list(purge_paths)}})

        # Re-embed changed
        chunks = []
        for fe in changed_entries:
            chunks.extend(parse_file(fe))
        if chunks:
            emb = get_embedder().embed_documents([c.content for c in chunks])
            import uuid as _u
            ids = [str(_u.uuid4()) for _ in chunks]
            collection.upsert(
                ids=ids,
                documents=[c.content for c in chunks],
                metadatas=[{
                    "repo_id": repo_id, "path": c.rel_path, "language": c.language,
                    "symbol_name": c.symbol_name or "", "symbol_kind": c.symbol_kind or "",
                    "start_line": c.start_line, "end_line": c.end_line,
                    "source": c.rel_path, "sha": head_sha,
                } for c in chunks],
                embeddings=emb,
            )

        # Graph: cheapest correct thing is to rebuild it from the current
        # tree. Kuzu writes are fast at this scale; incremental graph diffs
        # are hard because edges cross files.
        from src.nodes.ingestion.graph_build import graph_build_node
        graph_build_node({"repo_id": repo_id, "files": all_files, "clone_path": str(clone_dest)})

        _set_status(
            repo_id, RepoStatus.COMPLETED,
            last_indexed_sha=head_sha,
            error=None,
        )
        logger.info(f"[reindex] repo={repo_id} changed={len(changed_entries)} removed={len(removed)}")
        return {"changed": len(changed_entries), "removed": len(removed), "sha": head_sha}
    finally:
        remove_clone(clone_dest)

        
@celery_app.task(
    bind=True,
    name="ingest_repo_task",
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def ingest_repo_task(self, repo_id: str) -> dict:
    logger.info(f"[ingest_repo_task] start repo_id={repo_id}")

    # Load repo row
    db = get_sync_db()
    try:
        repo = db.get(Repo, repo_id)
        if not repo:
            logger.error(f"[ingest_repo_task] repo {repo_id} not found")
            return {"status": "not_found"}
        clone_url = repo.clone_url
        owner, name = repo.owner, repo.name
        token = decrypt_token(repo.encrypted_token) if repo.encrypted_token else None
    finally:
        db.close()

    clone_dest = Path(settings.REPO_CLONE_DIR) / repo_id
    ref = GitHubRepoRef(owner=owner, name=name, clone_url=clone_url)

    try:
        _set_status(repo_id, RepoStatus.CLONING)
        remove_clone(clone_dest)  # in case of leftover from a failed run
        head_sha = clone_repo(ref, clone_dest, token=token, depth=1)

        _set_status(repo_id, RepoStatus.PARSING)
        files = walk_repo(clone_dest)

        # Enforce caps
        total_bytes = sum(f.size for f in files)
        if len(files) > settings.REPO_MAX_FILES:
            raise RepoCloneError(
                f"Repo has {len(files)} indexable files; limit is {settings.REPO_MAX_FILES}"
            )
        if total_bytes > settings.REPO_MAX_SIZE_MB * 1024 * 1024:
            raise RepoCloneError(
                f"Repo indexable size {total_bytes/1024/1024:.1f}MB exceeds "
                f"{settings.REPO_MAX_SIZE_MB}MB cap"
            )

        _set_status(
            repo_id, RepoStatus.EMBEDDING,
            total_files=len(files), size_bytes=total_bytes,
        )

        final_state: dict = {}
        for step in code_ingestion_graph.stream({
            "repo_id": repo_id,
            "user_id": str(repo.user_id) if repo else "",
            "clone_path": str(clone_dest),
            "head_sha": head_sha,
            "files": files,
        }):
            for node_name, node_output in step.items():
                final_state.update(node_output or {})
                if node_name == "embed":
                    _set_status(repo_id, RepoStatus.STORING)
                elif node_name == "store":
                    _set_status(repo_id, RepoStatus.GRAPH_BUILDING)

        stored = final_state.get("stored_chunk_count", 0)
        _set_status(
            repo_id, RepoStatus.COMPLETED,
            indexed_files=len(files),
            total_chunks=stored,
            last_indexed_sha=head_sha,
            error=None,
        )
        logger.info(f"[ingest_repo_task] done repo_id={repo_id} chunks={stored}")
        return {"repo_id": repo_id, "status": "completed", "chunks": stored}

    except Exception as exc:
        logger.exception(f"[ingest_repo_task] failed repo_id={repo_id}")
        _set_status(repo_id, RepoStatus.FAILED, error=str(exc)[:1000])
        try:
            raise self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            raise
    finally:
        remove_clone(clone_dest)
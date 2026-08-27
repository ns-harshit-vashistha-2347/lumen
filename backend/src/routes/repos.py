from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.crypto import encrypt_token
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.github_client import (
    RepoCloneError, clone_repo, parse_github_url, remove_clone, walk_repo,
)
from src.core.kuzu_client import drop_kuzu
from src.core.logging import get_logger
from src.core.vectorstore import get_chroma_client
from src.models.repo import Repo, RepoStatus
from src.models.user import User
from src.schemas.repo import (
    RepoConnectRequest, RepoPreviewRequest, RepoPreviewResponse, RepoResponse,
)
from src.tasks.code_ingestion_tasks import ingest_repo_task

repos_router = APIRouter(prefix="/repos", tags=["repos"])
logger = get_logger(__name__)


def _collection_name(repo_id: uuid.UUID) -> str:
    return f"{settings.REPO_COLLECTION_PREFIX}{repo_id.hex}"


@repos_router.post("/preview", response_model=RepoPreviewResponse)
async def preview_repo(payload: RepoPreviewRequest, current_user: User = Depends(get_current_user)):
    """Shallow-clone into a temp dir, walk, then delete — return the count
    the user will actually index BEFORE we commit anything to the DB."""
    try:
        ref = parse_github_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    with tempfile.TemporaryDirectory(prefix="lumen_preview_") as td:
        dest = Path(td) / "clone"
        try:
            clone_repo(ref, dest, token=payload.token, depth=1)
        except RepoCloneError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        files = walk_repo(dest)
        total_bytes = sum(f.size for f in files)

    would_reject = False
    reason = None
    if len(files) > settings.REPO_MAX_FILES:
        would_reject = True
        reason = f"{len(files)} files > cap {settings.REPO_MAX_FILES}"
    elif total_bytes > settings.REPO_MAX_SIZE_MB * 1024 * 1024:
        would_reject = True
        reason = f"{total_bytes/1024/1024:.1f}MB > cap {settings.REPO_MAX_SIZE_MB}MB"

    return RepoPreviewResponse(
        owner=ref.owner, name=ref.name,
        estimated_files=len(files),
        estimated_size_mb=round(total_bytes / 1024 / 1024, 2),
        would_reject=would_reject,
        reject_reason=reason,
    )


@repos_router.post("", response_model=RepoResponse)
async def connect_repo(
    payload: RepoConnectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        ref = parse_github_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # De-dupe per user
    existing = await db.execute(
        select(Repo).where(
            Repo.user_id == current_user.id,
            Repo.provider == "github",
            Repo.owner == ref.owner,
            Repo.name == ref.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"{ref.full_name} is already connected")

    repo_id = uuid.uuid4()
    default_branch = (payload.default_branch or "main").strip() or "main"
    repo = Repo(
        id=repo_id,
        user_id=current_user.id,
        provider="github",
        owner=ref.owner,
        name=ref.name,
        default_branch=default_branch,
        clone_url=ref.clone_url,
        is_private=bool(payload.token),
        encrypted_token=encrypt_token(payload.token) if payload.token else None,
        status=RepoStatus.PENDING,
        collection_name=_collection_name(repo_id),
    )
    db.add(repo)
    await db.commit()
    await db.refresh(repo)

    ingest_repo_task.delay(str(repo_id))
    logger.info(f"[/repos] queued ingestion for {ref.full_name} user={current_user.id}")
    return repo


@repos_router.get("", response_model=list[RepoResponse])
async def list_repos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Repo).where(Repo.user_id == current_user.id).order_by(Repo.created_at.desc())
    )
    return result.scalars().all()


@repos_router.get("/{repo_id}", response_model=RepoResponse)
async def get_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Repo).where(Repo.id == repo_id, Repo.user_id == current_user.id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    return repo


@repos_router.post("/{repo_id}/refresh", response_model=RepoResponse)
async def refresh_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Repo).where(Repo.id == repo_id, Repo.user_id == current_user.id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    if repo.status in (
        RepoStatus.PENDING, RepoStatus.CLONING, RepoStatus.PARSING,
        RepoStatus.EMBEDDING, RepoStatus.STORING, RepoStatus.GRAPH_BUILDING,
    ):
        raise HTTPException(status_code=409, detail=f"Repo is currently {repo.status.value}")
    repo.status = RepoStatus.PENDING
    repo.error_message = None
    await db.commit()
    await db.refresh(repo)
    ingest_repo_task.delay(str(repo_id))
    return repo


@repos_router.delete("/{repo_id}", status_code=204)
async def delete_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Repo).where(Repo.id == repo_id, Repo.user_id == current_user.id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")

    try:
        get_chroma_client().delete_collection(repo.collection_name)
    except Exception as exc:
        logger.warning(f"[/repos] failed to delete chroma collection {repo.collection_name}: {exc}")

    try:
        drop_kuzu(str(repo_id))
    except Exception as exc:
        logger.warning(f"[/repos] failed to drop kuzu graph for {repo_id}: {exc}")

    await db.delete(repo)
    await db.commit()
    return None


from src.models.repo import RepoFile
from sqlalchemy import func

@repos_router.get("/{repo_id}/progress")
async def repo_progress(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Repo).where(Repo.id == repo_id, Repo.user_id == current_user.id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")

    # Rough progress: how many RepoFile rows exist vs total_files seen so far.
    stored_count = (await db.execute(
        select(func.count(RepoFile.id)).where(RepoFile.repo_id == repo_id)
    )).scalar_one()

    order = [
        "pending", "cloning", "parsing", "embedding",
        "storing", "graph_building", "completed",
    ]
    try:
        pct = round((order.index(repo.status.value) / (len(order) - 1)) * 100)
    except ValueError:
        pct = 0

    return {
        "status": repo.status.value,
        "percent": pct if repo.status.value != "failed" else 0,
        "total_files": repo.total_files,
        "indexed_files": stored_count,
        "total_chunks": repo.total_chunks,
        "error_message": repo.error_message,
    }
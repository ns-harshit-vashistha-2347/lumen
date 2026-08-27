from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.models.repo import Repo
from src.models.user import User
from src.tasks.code_ingestion_tasks import reindex_repo_task

webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = get_logger(__name__)


def _parse_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid repo id")


@webhook_router.post("/repos/{repo_id}/rotate-secret")
async def rotate_secret(
    repo_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate/rotate the shared secret. Show the returned value ONCE in the
    UI; it's not readable back out later (only its hash comparison is used)."""
    repo_uuid = _parse_uuid(repo_id)
    repo = (await db.execute(
        select(Repo).where(Repo.id == repo_uuid, Repo.user_id == current_user.id)
    )).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    new_secret = secrets.token_hex(20)
    repo.webhook_secret = new_secret
    await db.commit()
    return {"webhook_url": f"/webhooks/github/{repo.id}", "secret": new_secret}


@webhook_router.post("/github/{repo_id}")
async def github_push(
    repo_id: str,
    request: Request,
    x_hub_signature_256: str | None = Header(default=None, convert_underscores=False),
    x_github_event: str | None = Header(default=None, convert_underscores=False),
    db: AsyncSession = Depends(get_db),
):
    """GitHub push webhook. Configure in the repo's Settings → Webhooks:
      Payload URL: https://<your-domain>/webhooks/github/<repo_id>
      Content type: application/json
      Secret: the value returned by /rotate-secret
      Events: Just the push event."""
    repo_uuid = _parse_uuid(repo_id)
    body = await request.body()

    repo = (await db.execute(select(Repo).where(Repo.id == repo_uuid))).scalar_one_or_none()
    if not repo or not repo.webhook_secret:
        raise HTTPException(status_code=404, detail="Webhook not configured for this repo")

    expected = "sha256=" + hmac.new(repo.webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    if not x_hub_signature_256 or not hmac.compare_digest(expected, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Bad signature")

    if x_github_event == "ping":
        return {"ok": True, "pong": True}
    if x_github_event != "push":
        return {"ok": True, "ignored": x_github_event}

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload shape")

    new_sha = payload.get("after")
    ref = payload.get("ref") or ""
    # Match the full ref exactly so branches whose name is a suffix of another
    # (e.g. "main" vs "mainline") don't collide.
    if ref != f"refs/heads/{repo.default_branch}":
        return {"ok": True, "skipped": f"non-default branch {ref}"}

    reindex_repo_task.delay(str(repo.id), new_sha)
    short_sha = new_sha[:7] if isinstance(new_sha, str) and new_sha else "?"
    logger.info(f"[webhook] queued reindex for {repo.owner}/{repo.name} sha={short_sha}")
    return {"ok": True, "queued": True}
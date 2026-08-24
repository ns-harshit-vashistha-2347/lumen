import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.db import get_db
from src.core.deps import get_current_user
from src.models.document import Document
from src.models.user import User
from src.core.llm_router import get_router
from src.schemas.document import DocumentStatusResponse

status_router = APIRouter(prefix="/documents", tags=["documents"])


@status_router.get("/providers")
async def provider_health():
    return get_router().health_snapshot()


@status_router.get("/{document_id}/status", response_model=DocumentStatusResponse)
async def get_document_status(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where(
            Document.id == document_id, Document.user_id == current_user.id
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.models.document import Document, DocumentStatus
from src.models.user import User
from src.schemas.document import DocumentStatusResponse, DocumentUploadResponse
from src.tasks.ingestion_tasks import ingest_document_task


document_router = APIRouter(prefix="/documents", tags=["Documents"])
logger = get_logger(__name__)


@document_router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in settings.allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(settings.allowed_extensions)}",
        )

    document_id = uuid.uuid4()

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    stored_filename = f"{document_id}{ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, stored_filename)

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    chunk_size = 1024 * 1024  # 1 MiB
    total = 0
    try:
        with open(file_path, "wb") as f:
            while chunk := await file.read(chunk_size):
                total += len(chunk)
                if total > max_bytes:
                    f.close()
                    os.remove(file_path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds max upload size of {settings.MAX_UPLOAD_SIZE_MB}MB",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise

    if total == 0:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    doc = Document(
        id=document_id,
        user_id=current_user.id,
        filename=file.filename or stored_filename,
        file_path=file_path,
        source_type="document",
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.commit()

    task = ingest_document_task.delay(str(document_id), file_path, "document", str(current_user.id))
    logger.info(
        f"Queued ingestion for document_id={document_id} user_id={current_user.id} task_id={task.id}"
    )

    return DocumentUploadResponse(
        document_id=document_id,
        filename=doc.filename,
        status=doc.status,
        task_id=task.id,
    )


@document_router.get("", response_model=list[DocumentStatusResponse])
async def list_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Document)
        .where(Document.user_id == current_user.id)
        .order_by(Document.created_at.desc())
    )
    return result.scalars().all()


@document_router.get("/{document_id}", response_model=DocumentStatusResponse)
async def get_document(
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


@document_router.delete("/{document_id}", status_code=204)
async def delete_document(
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

    try:
        if os.path.exists(doc.file_path):
            os.remove(doc.file_path)
    except Exception as exc:
        logger.warning(f"Failed to delete file {doc.file_path}: {exc}")

    await db.delete(doc)
    await db.commit()
    return None

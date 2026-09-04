import os
import mimetypes
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
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
    if not file.filename or not file.filename.strip():
        raise HTTPException(status_code=400, detail="Filename is required")
    ext = os.path.splitext(file.filename)[1].lower()
    if not ext or ext not in settings.allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'none'}'. Allowed: {sorted(settings.allowed_extensions)}",
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


@document_router.get("/{document_id}/preview")
async def preview_document(
    document_id: uuid.UUID,
    limit: int = Query(default=8, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the first `limit` chunks of a document — powers the library
    preview pane so users can peek at what got indexed without downloading
    the source file."""
    result = await db.execute(
        select(Document).where(
            Document.id == document_id, Document.user_id == current_user.id
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunks: list[dict] = []
    if doc.status == DocumentStatus.COMPLETED:
        try:
            collection = get_collections(settings.CHROMA_COLLECTION_DOCUMENTS)
            data = collection.get(
                where={"$and": [
                    {"user_id": str(current_user.id)},
                    {"document_id": str(document_id)},
                ]},
                include=["metadatas", "documents"],
                limit=limit,
            )
            documents = data.get("documents", []) or []
            metadatas = data.get("metadatas", []) or []
            for content, metadata in zip(documents, metadatas):
                metadata = metadata or {}
                chunks.append({
                    "content": (content or "")[:1200],
                    "page": metadata.get("page_number") or metadata.get("page"),
                    "chunk_index": metadata.get("chunk_index"),
                })
        except Exception as exc:
            logger.warning(f"[/documents/preview] chroma fetch failed: {exc}")

    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "status": doc.status.value if hasattr(doc.status, "value") else str(doc.status),
        "chunk_count": doc.chunk_count,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "chunks": chunks,
    }


# --------------------------------------------------------------------------
# Source viewer endpoints — power the click-through from a chat citation
# to the original document with the exact passage highlighted.
# --------------------------------------------------------------------------


@document_router.get("/{document_id}/raw")
async def raw_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream the original uploaded file back to the owner. Used by the
    in-app document viewer to render PDFs natively via an <iframe>. Never
    exposed anonymously — the owner-check is enforced on every request."""
    result = await db.execute(
        select(Document).where(
            Document.id == document_id, Document.user_id == current_user.id
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=410, detail="Original file no longer on disk")
    mime, _ = mimetypes.guess_type(doc.filename)
    return FileResponse(
        doc.file_path,
        media_type=mime or "application/octet-stream",
        filename=doc.filename,
        # inline so PDFs render in <iframe>/<embed>, not download-forced.
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )


@document_router.get("/{document_id}/chunks")
async def list_document_chunks(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return every indexed chunk of the document with its metadata
    (chunk_index, page, start/end line offsets). The viewer uses this to
    show a chunk sidebar and to highlight all-other citations in the same
    doc while one is being inspected."""
    result = await db.execute(
        select(Document).where(
            Document.id == document_id, Document.user_id == current_user.id
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunks: list[dict] = []
    if doc.status == DocumentStatus.COMPLETED:
        try:
            collection = get_collections(settings.CHROMA_COLLECTION_DOCUMENTS)
            data = collection.get(
                where={"$and": [
                    {"user_id": str(current_user.id)},
                    {"document_id": str(document_id)},
                ]},
                include=["metadatas", "documents"],
            )
            ids = data.get("ids", []) or []
            documents = data.get("documents", []) or []
            metadatas = data.get("metadatas", []) or []
            for cid, content, metadata in zip(ids, documents, metadatas):
                md = metadata or {}
                chunks.append({
                    "id": cid,
                    "content": content or "",
                    "chunk_index": md.get("chunk_index"),
                    "page": md.get("page_number") or md.get("page"),
                    "start_line": md.get("start_line"),
                    "end_line": md.get("end_line"),
                    "start_char": md.get("start_char"),
                    "end_char": md.get("end_char"),
                    "source": md.get("source") or doc.filename,
                })
            # Order by chunk_index when available so the client can
            # reconstruct a stable "reading order".
            chunks.sort(
                key=lambda c: (
                    c.get("chunk_index") if c.get("chunk_index") is not None else 10**9
                )
            )
        except Exception as exc:
            logger.warning(f"[/documents/chunks] chroma fetch failed: {exc}")

    _, ext = os.path.splitext(doc.filename or "")
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "extension": ext.lower().lstrip("."),
        "chunks": chunks,
    }


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

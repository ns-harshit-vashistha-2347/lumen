import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from src.models.document import DocumentStatus


class DocumentUploadResponse(BaseModel):
    document_id: uuid.UUID
    filename: str
    status: DocumentStatus
    task_id: str


class DocumentStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    status: DocumentStatus
    chunk_count: int
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    document_ids: list[uuid.UUID] | None = None


class SourceChunk(BaseModel):
    content: str
    metadata: dict
    score: float


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]

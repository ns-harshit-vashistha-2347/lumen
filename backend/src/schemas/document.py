import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    query: str = Field(..., min_length=1, max_length=8000)
    top_k: int = Field(default=5, ge=1, le=50)
    document_ids: list[uuid.UUID] | None = None
    # If provided, the turn is appended to this session and prior turns are
    # included as chat history in the prompt.
    session_id: uuid.UUID | None = None
    # If true and session_id is None, the backend auto-creates a session and
    # returns its id — clients that want persistence but haven't opened a
    # session yet.
    persist: bool = False

    @field_validator("query")
    @classmethod
    def _strip_query(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("query cannot be blank")
        return stripped


class SourceChunk(BaseModel):
    content: str
    metadata: dict
    score: float


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    session_id: uuid.UUID | None = None
    trace_id: str | None = None

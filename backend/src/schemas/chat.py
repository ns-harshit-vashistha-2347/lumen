from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.models.chat import ChatKind, ChatRole


class ChatSessionCreate(BaseModel):
    kind: ChatKind
    title: Optional[str] = None
    repo_id: Optional[uuid.UUID] = None  # required when kind=code


class ChatSessionUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class ChatSessionResponse(BaseModel):
    id: uuid.UUID
    kind: ChatKind
    repo_id: Optional[uuid.UUID] = None
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: ChatRole
    content: str
    payload: Optional[dict[str, Any]] = None
    trace_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class GraphStructureResponse(BaseModel):
    name: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class GraphTraceResponse(BaseModel):
    trace_id: str
    events: list[dict[str, Any]]

from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CodeQueryRequest(BaseModel):
    repo_id: uuid.UUID
    query: str = Field(..., min_length=1, max_length=8000)
    top_k: Optional[int] = Field(default=None, ge=1, le=50)
    session_id: Optional[uuid.UUID] = None
    persist: bool = False

    @field_validator("query")
    @classmethod
    def _strip_query(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("query cannot be blank")
        return stripped


class CodeSourceChunk(BaseModel):
    path: str
    symbol_name: Optional[str] = None
    symbol_kind: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    content: str
    score: float


class GraphHit(BaseModel):
    kind: str            # "symbol" | "caller" | "callee"
    path: str
    symbol: Optional[str] = None
    symbol_kind: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None


class CodeQueryResponse(BaseModel):
    answer: str
    intent: str
    graph_hits: list[GraphHit] = []
    sources: list[CodeSourceChunk] = []
    session_id: Optional[uuid.UUID] = None
    trace_id: Optional[str] = None
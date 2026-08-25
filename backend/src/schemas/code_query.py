from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel


class CodeQueryRequest(BaseModel):
    repo_id: uuid.UUID
    query: str
    top_k: Optional[int] = None


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
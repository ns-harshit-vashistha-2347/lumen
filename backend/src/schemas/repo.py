from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from src.models.repo import RepoStatus


class RepoConnectRequest(BaseModel):
    url: str = Field(..., description="GitHub URL (https or ssh)")
    token: Optional[str] = Field(None, description="PAT for private repos; not stored in logs")
    default_branch: Optional[str] = "main"


class RepoPreviewRequest(BaseModel):
    url: str
    token: Optional[str] = None


class RepoPreviewResponse(BaseModel):
    owner: str
    name: str
    estimated_files: int
    estimated_size_mb: float
    would_reject: bool
    reject_reason: Optional[str] = None


class RepoResponse(BaseModel):
    id: uuid.UUID
    owner: str
    name: str
    provider: str
    default_branch: str
    is_private: bool
    status: RepoStatus
    error_message: Optional[str] = None
    total_files: int
    indexed_files: int
    total_chunks: int
    size_bytes: int
    last_indexed_sha: Optional[str] = None
    collection_name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
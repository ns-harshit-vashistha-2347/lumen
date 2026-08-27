from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from src.models.repo import RepoStatus


class RepoConnectRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048, description="GitHub URL (https or ssh)")
    token: Optional[str] = Field(None, max_length=1024, description="PAT for private repos; not stored in logs")
    default_branch: Optional[str] = Field(default="main", max_length=255)

    @field_validator("url")
    @classmethod
    def _strip_url(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("url cannot be blank")
        return stripped


class RepoPreviewRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    token: Optional[str] = Field(None, max_length=1024)

    @field_validator("url")
    @classmethod
    def _strip_url(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("url cannot be blank")
        return stripped


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
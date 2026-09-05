from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base


class RepoStatus(enum.Enum):
    PENDING = "pending"        
    CLONING = "cloning"
    PARSING = "parsing"
    EMBEDDING = "embedding"
    STORING = "storing"
    GRAPH_BUILDING = "graph_building"  
    COMPLETED = "completed"
    FAILED = "failed"


class Repo(Base):
    __tablename__ = "repos"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "owner", "name", name="uq_user_repo"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="github")
    owner: Mapped[str] = mapped_column(String(255), nullable=False)     # e.g. "vercel"
    name: Mapped[str] = mapped_column(String(255), nullable=False)      # e.g. "next.js"
    default_branch: Mapped[str] = mapped_column(String(255), nullable=False, default="main")
    clone_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    is_private: Mapped[bool] = mapped_column(default=False, nullable=False)

    
    encrypted_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    # values_callable so the DB sees `pending`/`cloning`/... rather than the
    # Python member names `PENDING`/`CLONING`/... which don't match the enum
    # values declared in the migration.
    status: Mapped[RepoStatus] = mapped_column(
        Enum(
            RepoStatus,
            name="repostatus",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=RepoStatus.PENDING,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    
    total_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    indexed_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_indexed_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)

    collection_name: Mapped[str] = mapped_column(String(255), nullable=False)

    webhook_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Auto-generated markdown tour of the repo (see /repos/{id}/tour).
    # Written asynchronously at the end of ingest; NULL until the tour
    # task completes. Regeneratable via POST /repos/{id}/tour/regenerate.
    tour_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    tour_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    files: Mapped[list["RepoFile"]] = relationship(
        "RepoFile", back_populates="repo", cascade="all, delete-orphan"
    )


class RepoFile(Base):
    __tablename__ = "repo_files"
    __table_args__ = (
        UniqueConstraint("repo_id", "path", name="uq_repo_file_path"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)   # repo-relative
    language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sha: Mapped[str | None] = mapped_column(String(64), nullable=True)   # git blob sha
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    repo: Mapped[Repo] = relationship("Repo", back_populates="files")
"""Eval harness — three tiny tables.

  eval_suites    a named collection of cases scoped to some documents
  eval_cases     a single {question, expected} row inside a suite
  eval_runs      one execution of a suite (fan-out over its cases)
  eval_results   per-case outcome inside a run: actual answer + judge verdict

The judge is an LLM comparing `expected` vs `actual`. Deterministic
temperature=0. Grading is intentionally a 4-value ordinal (pass/partial/
fail/error) instead of a numeric score — much easier to reason about and
to render as a per-run stripe.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base


class EvalRunStatus(enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class EvalVerdict(enum.Enum):
    PASS = "pass"
    PARTIAL = "partial"
    FAIL = "fail"
    ERROR = "error"   # pipeline blew up; not a model failure


def _enum_values(e):
    return [m.value for m in e]


class EvalSuite(Base):
    __tablename__ = "eval_suites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Scope every case in this suite to a fixed set of documents (like the
    # normal /query document_ids). NULL = whole library at run time.
    document_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    cases: Mapped[list["EvalCase"]] = relationship(
        "EvalCase", back_populates="suite", cascade="all, delete-orphan",
        order_by="EvalCase.created_at",
    )
    runs: Mapped[list["EvalRun"]] = relationship(
        "EvalRun", back_populates="suite", cascade="all, delete-orphan",
        order_by="EvalRun.created_at.desc()",
    )


class EvalCase(Base):
    __tablename__ = "eval_cases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_suites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-form. The judge prompt handles both exact-expected-answer AND
    # criteria-style ("must mention X, must not mention Y") input.
    expected: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    suite: Mapped[EvalSuite] = relationship("EvalSuite", back_populates="cases")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_suites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    status: Mapped[EvalRunStatus] = mapped_column(
        Enum(EvalRunStatus, name="evalrunstatus", values_callable=_enum_values),
        nullable=False, default=EvalRunStatus.QUEUED,
    )
    # Snapshot of the pipeline settings the run used, so a later "why did
    # this regress?" is answerable.
    settings_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Aggregates (populated as results land — cheap to recompute).
    total_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pass_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    partial_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fail_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    suite: Mapped[EvalSuite] = relationship("EvalSuite", back_populates="runs")
    results: Mapped[list["EvalResult"]] = relationship(
        "EvalResult", back_populates="run", cascade="all, delete-orphan",
    )


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_cases.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    verdict: Mapped[EvalVerdict] = mapped_column(
        Enum(EvalVerdict, name="evalverdict", values_callable=_enum_values),
        nullable=False,
    )
    actual_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    judge_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Full sources payload the pipeline picked — useful for post-hoc
    # "would a different top_k have helped?" analysis.
    sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    run: Mapped[EvalRun] = relationship("EvalRun", back_populates="results")

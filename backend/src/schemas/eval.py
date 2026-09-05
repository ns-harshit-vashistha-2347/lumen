from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class EvalSuiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    document_ids: list[uuid.UUID] | None = None


class EvalCaseCreate(BaseModel):
    question: str = Field(min_length=1)
    expected: str = Field(min_length=1)


class EvalCaseResponse(BaseModel):
    id: uuid.UUID
    question: str
    expected: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EvalSuiteResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    document_ids: list[uuid.UUID] | None
    created_at: datetime
    updated_at: datetime
    case_count: int = 0

    model_config = {"from_attributes": True}


class EvalRunResponse(BaseModel):
    id: uuid.UUID
    suite_id: uuid.UUID
    status: str
    total_cases: int
    pass_count: int
    partial_count: int
    fail_count: int
    error_count: int
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EvalResultResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    verdict: str
    actual_answer: str | None
    judge_reason: str | None
    latency_ms: int | None
    score: float | None
    sources: list | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EvalRunDetailResponse(EvalRunResponse):
    results: list[EvalResultResponse] = []
    cases: list[EvalCaseResponse] = []

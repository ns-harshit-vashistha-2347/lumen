from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.models.eval import (
    EvalCase, EvalResult, EvalRun, EvalRunStatus, EvalSuite,
)
from src.models.user import User
from src.schemas.eval import (
    EvalCaseCreate, EvalCaseResponse, EvalRunDetailResponse, EvalRunResponse,
    EvalSuiteCreate, EvalSuiteResponse,
)

evals_router = APIRouter(prefix="/evals", tags=["evals"])
logger = get_logger(__name__)


async def _load_suite(db: AsyncSession, user: User, suite_id: uuid.UUID) -> EvalSuite:
    result = await db.execute(
        select(EvalSuite).where(
            EvalSuite.id == suite_id, EvalSuite.user_id == user.id
        )
    )
    suite = result.scalar_one_or_none()
    if suite is None:
        raise HTTPException(status_code=404, detail="Eval suite not found")
    return suite


async def _suite_response(db: AsyncSession, suite: EvalSuite) -> EvalSuiteResponse:
    count = (await db.execute(
        select(func.count(EvalCase.id)).where(EvalCase.suite_id == suite.id)
    )).scalar_one()
    return EvalSuiteResponse(
        id=suite.id, name=suite.name, description=suite.description,
        document_ids=suite.document_ids or None,
        created_at=suite.created_at, updated_at=suite.updated_at,
        case_count=int(count),
    )


@evals_router.post("/suites", response_model=EvalSuiteResponse)
async def create_suite(
    payload: EvalSuiteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suite = EvalSuite(
        user_id=current_user.id,
        name=payload.name.strip(),
        description=payload.description,
        document_ids=[str(d) for d in payload.document_ids] if payload.document_ids else None,
    )
    db.add(suite)
    await db.commit()
    await db.refresh(suite)
    return await _suite_response(db, suite)


@evals_router.get("/suites", response_model=list[EvalSuiteResponse])
async def list_suites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(EvalSuite)
        .where(EvalSuite.user_id == current_user.id)
        .order_by(EvalSuite.updated_at.desc())
    )).scalars().all()
    return [await _suite_response(db, s) for s in rows]


@evals_router.get("/suites/{suite_id}", response_model=EvalSuiteResponse)
async def get_suite(
    suite_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suite = await _load_suite(db, current_user, suite_id)
    return await _suite_response(db, suite)


@evals_router.delete("/suites/{suite_id}", status_code=204)
async def delete_suite(
    suite_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suite = await _load_suite(db, current_user, suite_id)
    await db.delete(suite)
    await db.commit()
    return None


@evals_router.post("/suites/{suite_id}/cases", response_model=EvalCaseResponse)
async def add_case(
    suite_id: uuid.UUID,
    payload: EvalCaseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suite = await _load_suite(db, current_user, suite_id)
    case = EvalCase(
        suite_id=suite.id, question=payload.question.strip(), expected=payload.expected.strip()
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return case


@evals_router.get("/suites/{suite_id}/cases", response_model=list[EvalCaseResponse])
async def list_cases(
    suite_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_suite(db, current_user, suite_id)
    rows = (await db.execute(
        select(EvalCase)
        .where(EvalCase.suite_id == suite_id)
        .order_by(EvalCase.created_at)
    )).scalars().all()
    return rows


@evals_router.delete("/cases/{case_id}", status_code=204)
async def delete_case(
    case_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(EvalCase, EvalSuite)
        .join(EvalSuite, EvalSuite.id == EvalCase.suite_id)
        .where(EvalCase.id == case_id, EvalSuite.user_id == current_user.id)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Case not found")
    case, _ = row
    await db.delete(case)
    await db.commit()
    return None


@evals_router.post("/suites/{suite_id}/run", response_model=EvalRunResponse)
async def start_run(
    suite_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suite = await _load_suite(db, current_user, suite_id)
    # Require at least one case; queuing an empty run makes no sense.
    count = (await db.execute(
        select(func.count(EvalCase.id)).where(EvalCase.suite_id == suite_id)
    )).scalar_one()
    if not count:
        raise HTTPException(status_code=400, detail="Suite has no cases")
    run = EvalRun(
        suite_id=suite.id,
        status=EvalRunStatus.QUEUED,
        total_cases=int(count),
        settings_snapshot={
            # Cheap-and-honest snapshot; extend as more knobs land.
            "top_k": 5,
            "scope": "document_ids" if suite.document_ids else "all",
        },
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    from src.tasks.eval_task import run_eval_suite_task
    run_eval_suite_task.delay(str(run.id))
    return run


@evals_router.get("/suites/{suite_id}/runs", response_model=list[EvalRunResponse])
async def list_runs(
    suite_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_suite(db, current_user, suite_id)
    rows = (await db.execute(
        select(EvalRun)
        .where(EvalRun.suite_id == suite_id)
        .order_by(EvalRun.created_at.desc())
    )).scalars().all()
    return rows


@evals_router.get("/runs/{run_id}", response_model=EvalRunDetailResponse)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Owner check via suite.
    row = (await db.execute(
        select(EvalRun, EvalSuite)
        .join(EvalSuite, EvalSuite.id == EvalRun.suite_id)
        .where(EvalRun.id == run_id, EvalSuite.user_id == current_user.id)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    run, suite = row
    cases = (await db.execute(
        select(EvalCase).where(EvalCase.suite_id == suite.id).order_by(EvalCase.created_at)
    )).scalars().all()
    results = (await db.execute(
        select(EvalResult).where(EvalResult.run_id == run_id).order_by(EvalResult.created_at)
    )).scalars().all()
    return EvalRunDetailResponse(
        id=run.id, suite_id=run.suite_id, status=run.status.value,
        total_cases=run.total_cases, pass_count=run.pass_count,
        partial_count=run.partial_count, fail_count=run.fail_count,
        error_count=run.error_count,
        started_at=run.started_at, finished_at=run.finished_at,
        created_at=run.created_at,
        cases=[EvalCaseResponse.model_validate(c) for c in cases],
        results=[EvalResultResponse_from(r) for r in results],
    )


def EvalResultResponse_from(r: EvalResult):
    # Small helper to serialize the enum → its string value.
    from src.schemas.eval import EvalResultResponse
    return EvalResultResponse(
        id=r.id, case_id=r.case_id, verdict=r.verdict.value,
        actual_answer=r.actual_answer, judge_reason=r.judge_reason,
        latency_ms=r.latency_ms, score=r.score, sources=r.sources,
        created_at=r.created_at,
    )

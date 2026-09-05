"""Run an eval suite: iterate every case through the query pipeline, ask
a judge LLM to grade actual vs expected, persist per-case results and
suite-level aggregates.

Deliberately not parallelised inside a run — the shared LLM providers
already rate-limit, and serial execution keeps the judge prompts cache-
friendly. Multiple runs across suites still parallelise via Celery.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage, SystemMessage

from src.celery_app import celery_app
from src.core.llm import get_llm
from src.core.logging import get_logger
from src.core.sync_db import get_sync_db
from src.graphs.query_graph import query_graph
from src.models.eval import (
    EvalCase, EvalResult, EvalRun, EvalRunStatus, EvalSuite, EvalVerdict,
)

logger = get_logger(__name__)


JUDGE_SYSTEM_PROMPT = """You are grading an answer against an expected reference.

The `expected` field may be:
  - a full reference answer, OR
  - a list of criteria (e.g. "must mention X; must not mention Y"), OR
  - a mix of both.

Score the `actual` on that basis. Return STRICT JSON, no prose:
{"verdict": "pass" | "partial" | "fail", "reason": "one sentence", "score": 0.0..1.0}

Rules:
- "pass"    -> covers every substantive claim in `expected`, adds no false claims, phrasing may differ.
- "partial" -> covers some but not all, or covers everything but adds one unsupported claim.
- "fail"    -> misses the core of `expected`, contradicts it, or is off-topic.
- Ignore stylistic differences, ordering, and minor wording changes.
- If `expected` is a bulleted criteria list, a "pass" requires ALL criteria met."""


def _judge(question: str, expected: str, actual: str) -> tuple[EvalVerdict, str, float]:
    llm = get_llm(task="verify", temperature=0.0)
    try:
        resp = llm.invoke([
            SystemMessage(content=JUDGE_SYSTEM_PROMPT),
            HumanMessage(content=(
                f"Question: {question}\n\n"
                f"Expected:\n{expected}\n\n"
                f"Actual:\n{actual}"
            )),
        ])
        raw = (resp.content or "").strip()
        parsed = json.loads(raw)
        verdict = str(parsed.get("verdict", "fail")).lower()
        reason = str(parsed.get("reason", ""))[:2000]
        score = float(parsed.get("score", 0.0))
        v = {
            "pass": EvalVerdict.PASS,
            "partial": EvalVerdict.PARTIAL,
            "fail": EvalVerdict.FAIL,
        }.get(verdict, EvalVerdict.FAIL)
        return v, reason, max(0.0, min(1.0, score))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[eval.judge] failed: {exc}")
        return EvalVerdict.ERROR, f"judge error: {exc}", 0.0


def _run_case_sync(user_id: str, document_ids: list[str] | None, question: str) -> tuple[str, list, int]:
    """Execute the query pipeline synchronously for a single case.
    Returns (answer, sources_payload, latency_ms).

    The Celery task runs in a thread pool, so we drive the async graph via
    a fresh event loop rather than blocking a shared one.
    """
    import asyncio

    async def _go():
        state = {
            "query": question,
            "top_k": 5,
            "user_id": user_id,
            "document_ids": document_ids,
            "chat_history": [],
        }
        return await query_graph.ainvoke(state)

    loop = asyncio.new_event_loop()
    try:
        t0 = time.time()
        result = loop.run_until_complete(_go())
    finally:
        loop.close()
    answer = result.get("answer", "")
    sources_raw = (
        result.get("compressed_results")
        or result.get("reranked_results")
        or result.get("fused_results", [])
    )
    sources = [
        {
            "content": (c.metadata.get("original_content")
                        or c.metadata.get("raw_content", c.content))[:1500],
            "source": c.metadata.get("source"),
            "page": c.metadata.get("page_number") or c.metadata.get("page"),
            "path": c.metadata.get("path"),
            "start_line": c.metadata.get("start_line"),
            "end_line": c.metadata.get("end_line"),
            "score": c.score,
        }
        for c in sources_raw
    ]
    return answer, sources, int((time.time() - t0) * 1000)


@celery_app.task(bind=True, name="run_eval_suite_task", max_retries=0)
def run_eval_suite_task(self, run_id: str) -> dict:
    db = get_sync_db()
    try:
        run = db.get(EvalRun, run_id)
        if run is None:
            return {"status": "not_found"}
        suite = db.get(EvalSuite, run.suite_id)
        if suite is None:
            run.status = EvalRunStatus.FAILED
            db.commit()
            return {"status": "no_suite"}
        cases = list(suite.cases)
        run.status = EvalRunStatus.RUNNING
        run.started_at = datetime.now(timezone.utc)
        run.total_cases = len(cases)
        db.commit()
        user_id = str(suite.user_id)
        document_ids = list(suite.document_ids) if suite.document_ids else None
        # Snapshot: what the cases were, so a later regression compares apples-to-apples.
        cases_payload = [
            {"id": str(c.id), "question": c.question, "expected": c.expected}
            for c in cases
        ]
    finally:
        db.close()

    pass_count = partial_count = fail_count = error_count = 0
    for case in cases_payload:
        try:
            answer, sources, latency = _run_case_sync(
                user_id, document_ids, case["question"]
            )
            verdict, reason, score = _judge(case["question"], case["expected"], answer)
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"[eval] case failed: {exc}")
            answer, sources, latency = "", [], 0
            verdict, reason, score = EvalVerdict.ERROR, f"pipeline error: {exc}"[:1000], 0.0

        if verdict is EvalVerdict.PASS:
            pass_count += 1
        elif verdict is EvalVerdict.PARTIAL:
            partial_count += 1
        elif verdict is EvalVerdict.FAIL:
            fail_count += 1
        else:
            error_count += 1

        db = get_sync_db()
        try:
            db.add(EvalResult(
                run_id=run_id,
                case_id=case["id"],
                verdict=verdict,
                actual_answer=answer,
                judge_reason=reason,
                latency_ms=latency,
                sources=sources,
                score=score,
            ))
            r = db.get(EvalRun, run_id)
            if r is not None:
                r.pass_count = pass_count
                r.partial_count = partial_count
                r.fail_count = fail_count
                r.error_count = error_count
            db.commit()
        finally:
            db.close()

    db = get_sync_db()
    try:
        r = db.get(EvalRun, run_id)
        if r is not None:
            r.status = EvalRunStatus.COMPLETED
            r.finished_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()

    return {
        "status": "completed",
        "pass": pass_count, "partial": partial_count,
        "fail": fail_count, "error": error_count,
    }

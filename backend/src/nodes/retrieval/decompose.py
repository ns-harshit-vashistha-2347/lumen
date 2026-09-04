"""Multi-hop query decomposition.

Some questions can't be answered from a single retrieval pass because
they combine facts that live in different places — "how does auth flow
from login to the DB?", "compare X and Y across the two most recent
uploads". This node asks the LLM to split those into 2-4 focused
sub-questions and appends them to `state['queries']`, which both dense
and BM25 already iterate.

For single-hop questions the node emits nothing new and adds negligible
latency (one small classify+split call at temperature 0).
"""
from __future__ import annotations

import json

from langchain_core.messages import HumanMessage, SystemMessage

from src.core.cache import cached_llm_invoke
from src.core.config import settings
from src.core.llm import get_llm
from src.core.logging import get_logger

logger = get_logger(__name__)


DECOMPOSE_SYSTEM_PROMPT = """You split retrieval questions into focused sub-questions.

Given a user's question, decide:
- "single": one retrieval pass can answer it -> return an empty list.
- "multi": it stitches multiple facts / entities / files together
  -> split it into 2 to 4 independent sub-questions that, taken together,
  cover the answer. Each sub-question must be self-contained (a retrieval
  system can search for it without seeing the other sub-questions).

Rules:
- Preserve the original intent exactly. Do NOT add new topics.
- Sub-questions should be answerable independently against the corpus.
- If the question is already single-hop, return {"kind": "single", "sub_questions": []}.

Respond as JSON with exactly this shape, and nothing else:
{"kind": "single" | "multi", "sub_questions": ["...", "..."]}"""


_MAX_SUB_QUESTIONS = 4


def _fallback(state: dict) -> dict:
    return {
        "queries": state.get("queries") or [state.get("primary_query") or state["query"]],
        "sub_questions": [],
        "is_multihop": False,
    }


def decompose_query_node(state: dict) -> dict:
    if not getattr(settings, "QUERY_DECOMPOSITION_ENABLED", True):
        return _fallback(state)

    # Fast path: simple factual lookups are single-hop by construction.
    # Skip the LLM roundtrip.
    if state.get("complexity") == "simple":
        logger.info("[decompose] skipped: complexity=simple")
        return _fallback(state)

    raw = state.get("primary_query") or state["query"]
    llm = get_llm(task="rewrite", temperature=0.0)

    try:
        content = cached_llm_invoke("decompose", llm, [
            SystemMessage(content=DECOMPOSE_SYSTEM_PROMPT),
            HumanMessage(content=raw),
        ])
        parsed = json.loads(content.strip())
        kind = (parsed.get("kind") or "single").lower()
        subs_raw = parsed.get("sub_questions") or []
        subs = [str(s).strip() for s in subs_raw if str(s).strip()][:_MAX_SUB_QUESTIONS]
    except Exception as exc:
        logger.warning(f"[decompose] failed ({exc}); treating as single-hop")
        return _fallback(state)

    if kind != "multi" or not subs:
        return _fallback(state)

    # Merge sub-questions with any existing rewrite variants, de-duped.
    existing = state.get("queries") or [raw]
    seen: set[str] = set()
    merged: list[str] = []
    for q in [*existing, *subs]:
        k = q.lower().strip()
        if k and k not in seen:
            seen.add(k)
            merged.append(q)

    logger.info(f"[decompose] multi-hop → {len(subs)} sub-questions: {subs}")
    return {
        "queries": merged,
        "sub_questions": subs,
        "is_multihop": True,
    }

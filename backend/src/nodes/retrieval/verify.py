import json

from langchain_core.messages import HumanMessage, SystemMessage

from src.core.config import settings
from src.core.llm import get_llm
from src.core.logging import get_logger

logger = get_logger(__name__)

VERIFY_SYSTEM_PROMPT = """You verify whether an answer is fully supported by the given source passages.

Given a question, an answer, and the numbered source passages the answer was based on, judge each factual claim in the answer and return:

- "verdict": overall grade
    * "grounded"    -> every non-trivial claim in the answer is directly supported by at least one source passage.
    * "partial"     -> some claims are supported but others are not, or the answer stretches beyond what sources say.
    * "ungrounded"  -> the answer is largely unsupported, contradicts sources, or is fabricated.
- "reason": one short sentence explaining the verdict.
- "unsupported_claims": a list of the specific claims in the answer that are NOT supported by any source. Quote the claim, keep each under 30 words. Empty list if the verdict is "grounded".

Rules:
- Ignore purely narrative / non-factual sentences ("here is what I found", "in summary").
- A claim is "supported" only if a source passage clearly states or entails it. Merely mentioning a topic is not enough.
- Do not add commentary outside the JSON.

Respond as JSON with exactly this shape, and nothing else:
{"verdict": "grounded" | "partial" | "ungrounded", "reason": "...", "unsupported_claims": ["...", "..."]}"""


REGENERATE_SYSTEM_PROMPT = """You are fixing an answer that was found to include unsupported claims.

You will receive:
- The original question
- The prior answer
- The list of claims that were NOT supported by the sources
- The numbered source passages

Produce a revised answer that:
1. Removes or rewrites the unsupported claims so nothing survives that isn't grounded in the sources.
2. Keeps all supported content intact.
3. Cites sources inline as [#N].
4. If, after removing unsupported claims, no substantive answer remains, say so honestly.

Return only the revised answer text, no preamble."""


def _pick_chunks(state: dict):
    return (
        state.get("compressed_results")
        or state.get("reranked_results")
        or state.get("fused_results", [])
    )


def _format_sources(chunks) -> str:
    return "\n\n---\n\n".join(
        f"[#{i}] {c.content}" for i, c in enumerate(chunks, start=1)
    )


def verify_node(state: dict) -> dict:
    if not settings.SELF_CORRECTION_ENABLED:
        return {"verdict": "grounded", "correction_attempts": state.get("correction_attempts", 0)}

    answer = state.get("answer", "")
    chunks = _pick_chunks(state)

    if not answer or not chunks:
        return {"verdict": "grounded", "correction_attempts": state.get("correction_attempts", 0)}

    lower = answer.lower()
    if "couldn't find" in lower or "don't know" in lower or "no relevant" in lower:
        return {"verdict": "grounded", "correction_attempts": state.get("correction_attempts", 0)}

    query = state.get("primary_query") or state["query"]
    llm = get_llm(task="verify", temperature=0.0)

    try:
        response = llm.invoke([
            SystemMessage(content=VERIFY_SYSTEM_PROMPT),
            HumanMessage(content=(
                f"Question: {query}\n\n"
                f"Answer: {answer}\n\n"
                f"Sources:\n{_format_sources(chunks)}"
            )),
        ])
        parsed = json.loads(response.content.strip())
        verdict = parsed.get("verdict", "grounded")
        reason = parsed.get("reason", "")
        unsupported = [c for c in (parsed.get("unsupported_claims") or []) if isinstance(c, str)]
        logger.info(
            f"[verify_node] verdict={verdict} unsupported={len(unsupported)} reason='{reason}'"
        )
        return {
            "verdict": verdict,
            "verify_reason": reason,
            "unsupported_claims": unsupported,
            "correction_attempts": state.get("correction_attempts", 0),
        }

    except Exception as exc:
        logger.warning(f"[verify_node] verification failed ({exc}); passing through")
        return {"verdict": "grounded", "correction_attempts": state.get("correction_attempts", 0)}


def should_retry(state: dict) -> str:
    """Three-way decision:
      - "regenerate": partial verdict (some claims unsupported) → we can fix
        this by rewriting the answer against the same sources without paying
        for another retrieval pass.
      - "retry": ungrounded → the sources probably don't hold the answer at
        all; expand retrieval and try again from scratch.
      - "done": grounded or already retried.
    """
    verdict = state.get("verdict", "grounded")
    attempts = state.get("correction_attempts", 0)

    if verdict == "partial" and attempts < 1 and state.get("unsupported_claims"):
        logger.info("[should_retry] partial verdict → regenerating with unsupported-claim fixes")
        return "regenerate"
    if verdict == "ungrounded" and attempts < 1:
        logger.info("[should_retry] ungrounded → expanding retrieval and retrying")
        return "retry"
    return "done"


def expand_retrieval_node(state: dict) -> dict:
    return {
        "retrieval_k": settings.SELF_CORRECTION_EXPANDED_K,
        "correction_attempts": state.get("correction_attempts", 0) + 1,
    }


async def regenerate_node(state: dict) -> dict:
    """Cheap corrective loop: rewrite the answer to drop unsupported claims
    using the SAME sources. Costs one extra LLM call, no retrieval."""
    unsupported = state.get("unsupported_claims") or []
    if not unsupported:
        return {"correction_attempts": state.get("correction_attempts", 0) + 1}

    query = state.get("primary_query") or state["query"]
    chunks = _pick_chunks(state)
    prior = state.get("answer", "")
    llm = get_llm(task="generate_complex", temperature=0.1)

    bullet_claims = "\n".join(f"- {c}" for c in unsupported)
    try:
        resp = await llm.ainvoke([
            SystemMessage(content=REGENERATE_SYSTEM_PROMPT),
            HumanMessage(content=(
                f"Question: {query}\n\n"
                f"Prior answer:\n{prior}\n\n"
                f"Unsupported claims:\n{bullet_claims}\n\n"
                f"Sources:\n{_format_sources(chunks)}"
            )),
        ])
        revised = resp.content.strip() or prior
    except Exception as exc:
        logger.warning(f"[regenerate_node] failed ({exc}); keeping prior answer")
        return {"correction_attempts": state.get("correction_attempts", 0) + 1}

    return {
        "answer": revised,
        "correction_attempts": state.get("correction_attempts", 0) + 1,
        # Reset verdict so finalize doesn't mistakenly re-annotate the fixed answer.
        "verdict": "grounded",
        "unsupported_claims": [],
    }


def finalize_node(state: dict) -> dict:
    verdict = state.get("verdict", "grounded")
    answer = state.get("answer", "")

    if verdict == "ungrounded":
        annotated = (
            f"{answer}\n\n"
            f"_Note: I couldn't fully verify this answer against the provided sources. "
            f"Treat it with caution._"
        )
        return {"answer": annotated}
    if verdict == "partial":
        annotated = (
            f"{answer}\n\n"
            f"_Note: part of this answer may not be fully supported by the sources._"
        )
        return {"answer": annotated}
    return {}

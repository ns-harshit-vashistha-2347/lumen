from langchain_core.messages import HumanMessage, SystemMessage

from src.core.cache import cached_llm_invoke
from src.core.llm import get_llm
from src.core.logging import get_logger

logger = get_logger(__name__)

CLASSIFY_SYSTEM_PROMPT = """Classify the user's question as either:
- "simple": a direct factual lookup answerable from a single passage (definitions, dates, names, numbers).
- "complex": needs reasoning, comparison, multi-passage synthesis, or summarization.

Respond with exactly one word: simple or complex."""


def classify_node(state: dict) -> dict:
    # prepare_node's fast-classify heuristic may have already decided.
    # When it did, keep that decision and skip the LLM call.
    existing = state.get("complexity")
    if existing in {"simple", "complex"}:
        logger.info(f"[classify_node] skipped: fast-classify set '{existing}'")
        return {"complexity": existing}

    query = state.get("primary_query") or state["query"]
    llm = get_llm(task="classify", temperature=0.0)

    try:
        content = cached_llm_invoke("classify", llm, [
            SystemMessage(content=CLASSIFY_SYSTEM_PROMPT),
            HumanMessage(content=query),
        ])
        label = content.strip().lower()
        complexity = "simple" if "simple" in label else "complex"
    except Exception as exc:
        logger.warning(f"[classify_node] failed ({exc}); defaulting to complex")
        complexity = "complex"

    logger.info(f"[classify_node] query classified as '{complexity}'")
    return {"complexity": complexity}
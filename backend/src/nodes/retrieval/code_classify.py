"""Classify a code question into one of: symbol / dependency / behavior / general.

- symbol:      "where is FooBar defined?", "show me class X"
- dependency:  "who calls process_batch?", "what does foo.py import?"
- behavior:    "how does auth work?", "explain retry logic"
- general:     everything else / falls back to plain RAG
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from src.core.llm import get_llm
from src.core.logging import get_logger

logger = get_logger(__name__)

CODE_CLASSIFY_PROMPT = """Classify the user's question about a codebase as exactly one of:

- "symbol": asks WHERE something is defined or to SHOW a specific function/class/module by name.
- "dependency": asks who CALLS X, what X CALLS, what X IMPORTS, or what depends on X.
- "behavior": asks HOW something works, to EXPLAIN logic, or to describe a flow.
- "general": everything else (setup, style, opinions, tangents).

Respond with exactly one word: symbol, dependency, behavior, or general."""


def code_classify_node(state: dict) -> dict:
    query = state.get("primary_query") or state["query"]
    llm = get_llm(task="code_classify", temperature=0.0, pipeline="code")
    try:
        resp = llm.invoke([
            SystemMessage(content=CODE_CLASSIFY_PROMPT),
            HumanMessage(content=query),
        ])
        label = resp.content.strip().lower().split()[0]
        if label not in {"symbol", "dependency", "behavior", "general"}:
            label = "behavior"
    except Exception as exc:
        logger.warning(f"[code_classify] failed ({exc}); defaulting to behavior")
        label = "behavior"
    logger.info(f"[code_classify] intent={label}")
    return {"code_intent": label}
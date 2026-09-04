import json

from langchain_core.messages import HumanMessage, SystemMessage

from src.core.config import settings
from src.core.llm import get_llm
from src.core.logging import get_logger

logger = get_logger(__name__)


REWRITE_SYSTEM_PROMPT = """You improve search queries for a retrieval system.

Given a user's raw question, produce:
1. A cleaner, keyword-rich version of the same question (the "primary" query).
2. {n_variants} alternate phrasings that a document might actually use to state the same information (the "variants").

Rules:
- Preserve the user's intent exactly. Do not add assumptions.
- Variants should differ in wording (synonyms, different phrasing) but ask for the same information.
- Do NOT answer the question. Only rewrite it.

Respond as JSON with exactly this shape, and nothing else:
{{"primary": "...", "variants": ["...", "..."]}}"""


def _fallback(query: str) -> dict:
    return {"queries": [query], "primary_query": query}


def query_rewrite_node(state: dict) -> dict:
    raw_query = state["query"]

    if not settings.QUERY_REWRITE_ENABLED:
        return {"queries": [raw_query], "primary_query": raw_query}

    # Fast path: prepare_node already tagged this as a simple factual lookup.
    # Rewrite is unlikely to help and costs an LLM roundtrip — skip.
    if state.get("complexity") == "simple":
        logger.info("[query_rewrite_node] skipped: complexity=simple")
        return {"queries": [raw_query], "primary_query": raw_query}

    n_variants = settings.QUERY_EXPANSION_COUNT
    llm = get_llm(task="rewrite", temperature=0.3)

    try:
        response = llm.invoke([
            SystemMessage(content=REWRITE_SYSTEM_PROMPT.format(n_variants=n_variants)),
            HumanMessage(content=raw_query)
        ])
        parsed = json.loads(response.content.strip())
        primary = parsed.get("primary", raw_query).strip() or raw_query
        variants = [v.strip() for v in parsed.get("variants", []) if v.strip()]

        seen = set()
        queries: list[str] = []

        for q in [primary, *variants, raw_query]:
            key = q.lower()
            if key not in seen:
                seen.add(key)
                queries.append(q)

        logger.info(f"[query_rewrite_node] rewrote into {len(queries)} variants: {queries}")
        return {"queries": queries, "primary_query": primary}
    except Exception as exc:
        logger.warning(f"[query_rewrite_node] rewrite failed ({exc}); falling back to raw query")
        return _fallback(raw_query)
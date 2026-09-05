from typing import Any, TypedDict, Annotated


from langgraph.graph import START, END, StateGraph

from src.core.config import settings
from src.nodes.retrieval.bm25 import bm25_retrieval_node
from src.nodes.retrieval.compression import compressed_node
from src.nodes.retrieval.decompose import decompose_query_node
from src.nodes.retrieval.dense import dense_retrieval_node
from src.nodes.retrieval.fusion import fusion_node
from src.nodes.retrieval.generation import generation_node
from src.nodes.retrieval.rerank import rerank_node
from src.nodes.retrieval.rewrite import query_rewrite_node
from src.nodes.retrieval.verify import (
    expand_retrieval_node,
    finalize_node,
    regenerate_node,
    should_retry,
    verify_node,
)
from src.nodes.retrieval.classify import classify_node
from src.nodes.retrieval.mmr import mmr_node


def _keep_last(_old: Any, new: Any) -> Any:
    return new


class QueryState(TypedDict, total=False):
    query: str
    top_k: int

    user_id: str | None
    document_ids: list[str] | None
    chat_history: list[dict]        # [{role, content}, ...] for multi-turn

    primary_query: str
    queries: list[str]
    sub_questions: list[str]
    is_multihop: bool

    retrieval_k: int

    dense_results: Annotated[list[Any], _keep_last]
    bm25_results: Annotated[list[Any], _keep_last]
    fused_results: list[Any]
    reranked_results: Annotated[list[Any], _keep_last]
    compressed_results: Annotated[list[Any], _keep_last]

    answer: Annotated[str, _keep_last]
    verdict: str
    verify_reason: str
    unsupported_claims: list[str]
    correction_attempts: int

    complexity: str


_MULTI_HOP_MARKERS = (
    " and ",
    " vs ",
    " versus ",
    " compare ",
    " compared ",
    " difference between ",
    " both ",
    " each of ",
    " list all ",
)


def _fast_classify(query: str) -> str | None:
    """Cheap heuristic: return "simple" for short, single-intent factual
    questions; "complex" for anything with connectors, comparisons, or long
    phrasing; None if unsure (fall through to LLM classifier).

    Runs in prepare_node so downstream rewrite/decompose/verify can skip
    entirely when we're confident it's simple. Saves 2-3 LLM roundtrips."""
    q = (query or "").strip().lower()
    if not q:
        return None
    words = q.split()
    n = len(words)
    if n > 20:
        return "complex"
    if any(m in f" {q} " for m in _MULTI_HOP_MARKERS):
        return "complex"
    # Short factual lookups: "who / what / when / where / how many …" under 12 words.
    if n <= 12 and words[0] in {"who", "what", "when", "where", "which", "define", "list"}:
        return "simple"
    if n <= 8:
        return "simple"
    return None  # let the LLM classifier decide


def prepare_node(state: dict) -> dict:
    top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)

    if settings.RERANK_ENABLED:
        retrieval_k = max(top_k, settings.RERANK_CANDIDATE_POOL)
    else:
        retrieval_k = top_k

    out: dict = {"top_k": top_k, "retrieval_k": retrieval_k, "correction_attempts": 0}
    if settings.QUERY_FAST_CLASSIFY:
        pre = _fast_classify(state.get("query", ""))
        if pre is not None:
            out["complexity"] = pre
            # Simple queries skip rewrite+decompose entirely — seed the
            # fields those nodes would have produced so retrieval works.
            if pre == "simple":
                q = state.get("query", "")
                out["primary_query"] = q
                out["queries"] = [q]
                out["sub_questions"] = [q]
                out["is_multihop"] = False
    return out


def _post_prepare_route(state: dict) -> list[str]:
    """Simple queries skip rewrite+decompose (saves 1-2 LLM roundtrips) and
    fan straight into both retrievers. Complex still funnels through
    rewrite → decompose first."""
    if state.get("complexity") == "simple":
        return ["dense", "bm25"]
    return ["rewrite"]



def build_query_graph():
    graph = StateGraph(QueryState)

    graph.add_node("prepare", prepare_node)
    graph.add_node("classify", classify_node)
    graph.add_node("mmr", mmr_node)
    graph.add_node("rewrite", query_rewrite_node)
    graph.add_node("decompose", decompose_query_node)
    graph.add_node("dense", dense_retrieval_node)
    graph.add_node("bm25", bm25_retrieval_node)
    graph.add_node("fusion", fusion_node)
    graph.add_node("rerank", rerank_node)
    graph.add_node("compression", compressed_node)
    graph.add_node("generation", generation_node)
    graph.add_node("verify", verify_node)
    graph.add_node("expand_retrieval", expand_retrieval_node)
    graph.add_node("regenerate", regenerate_node)
    graph.add_node("finalize", finalize_node)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare",
        _post_prepare_route,
        ["dense", "bm25", "rewrite"],
    )
    graph.add_edge("rewrite", "decompose")
    graph.add_edge("decompose", "dense")
    graph.add_edge("decompose", "bm25")
    graph.add_edge("dense", "fusion")
    graph.add_edge("bm25", "fusion")
    graph.add_edge("fusion", "mmr")
    graph.add_edge("mmr", "rerank")
    graph.add_edge("rerank", "classify")


    graph.add_conditional_edges(
        "classify",
        lambda state: state.get("complexity", "complex"),
        {
            "simple": "generation",
            "complex": "compression",
        },
    )
    graph.add_edge("compression", "generation")

    graph.add_conditional_edges(
        "verify",
        should_retry,
        {
            "retry": "expand_retrieval",
            "regenerate": "regenerate",
            "done": "finalize",
        },
    )
    graph.add_edge("expand_retrieval", "dense")
    # Regenerate reuses the same sources; skip retrieval and land straight
    # in finalize (verdict was reset to grounded inside regenerate_node).
    graph.add_edge("regenerate", "finalize")

    graph.add_conditional_edges(
        "generation",
        lambda state: state.get("complexity", "complex"),
        {
            "simple": "finalize",        
            "complex": "verify",
        },
    )

    graph.add_edge("finalize", END)

    return graph.compile()


query_graph = build_query_graph()


def _ready_for_generation(state: dict) -> dict:
    """No-op join point: both the 'simple' and 'complex' branches land here
    with everything generation_node needs already in state, without ever
    invoking the LLM. Lets callers (e.g. the /query/stream route) run
    retrieval exactly once and do their own single generation/stream call
    afterwards, instead of paying for generation twice."""
    return {}


def build_retrieval_graph():
    """Same retrieval pipeline as build_query_graph, but stops right before
    generation instead of calling the LLM to produce an answer."""
    graph = StateGraph(QueryState)

    graph.add_node("prepare", prepare_node)
    graph.add_node("classify", classify_node)
    graph.add_node("mmr", mmr_node)
    graph.add_node("rewrite", query_rewrite_node)
    graph.add_node("decompose", decompose_query_node)
    graph.add_node("dense", dense_retrieval_node)
    graph.add_node("bm25", bm25_retrieval_node)
    graph.add_node("fusion", fusion_node)
    graph.add_node("rerank", rerank_node)
    graph.add_node("compression", compressed_node)
    graph.add_node("ready", _ready_for_generation)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare",
        _post_prepare_route,
        ["dense", "bm25", "rewrite"],
    )
    graph.add_edge("rewrite", "decompose")
    graph.add_edge("decompose", "dense")
    graph.add_edge("decompose", "bm25")
    graph.add_edge("dense", "fusion")
    graph.add_edge("bm25", "fusion")
    graph.add_edge("fusion", "mmr")
    graph.add_edge("mmr", "rerank")
    graph.add_edge("rerank", "classify")

    graph.add_conditional_edges(
        "classify",
        lambda state: state.get("complexity", "complex"),
        {
            "simple": "ready",
            "complex": "compression",
        },
    )
    graph.add_edge("compression", "ready")
    graph.add_edge("ready", END)

    return graph.compile()


retrieval_graph = build_retrieval_graph()
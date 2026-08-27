from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from src.nodes.retrieval.code_bm25 import code_bm25_node, code_fusion_node
from src.nodes.retrieval.code_classify import code_classify_node
from src.nodes.retrieval.code_dense import code_dense_node
from src.nodes.retrieval.decompose import decompose_query_node
from src.nodes.retrieval.generation import generation_node
from src.nodes.retrieval.graph_query import graph_query_node


class CodeQueryState(TypedDict, total=False):
    query: str
    primary_query: str
    queries: list[str]
    sub_questions: list[str]
    is_multihop: bool
    top_k: int
    repo_id: str
    chat_history: list[dict]

    code_intent: str
    graph_hits: list[dict]
    focus_files: list[str]

    dense_results: list[Any]
    code_bm25_results: list[Any]
    reranked_results: list[Any]     # kept for compatibility with generation_node
    compressed_results: list[Any]
    fused_results: list[Any]
    answer: str
    complexity: str

    # Grounding verify (see verify_node)
    verdict: str
    verify_reason: str
    correction_attempts: int


def prepare_code_query(state: dict) -> dict:
    return {
        "primary_query": state["query"],
        "queries": [state["query"]],
        "complexity": "complex",
    }


def _code_ready(_state: dict) -> dict:
    """No-op join point — retrieval done, caller streams generation itself."""
    return {}


def build_code_query_graph():
    g = StateGraph(CodeQueryState)
    g.add_node("prepare", prepare_code_query)
    g.add_node("decompose", decompose_query_node)
    g.add_node("classify", code_classify_node)
    g.add_node("graph_query", graph_query_node)
    g.add_node("dense", code_dense_node)
    g.add_node("bm25", code_bm25_node)
    g.add_node("fusion", code_fusion_node)
    g.add_node("generation", generation_node)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "decompose")
    g.add_edge("decompose", "classify")
    g.add_edge("classify", "graph_query")
    # Parallel dense + BM25 retrieval after graph_query has decided focus_files.
    g.add_edge("graph_query", "dense")
    g.add_edge("graph_query", "bm25")
    # Fusion waits on both parallel branches (LangGraph joins them automatically
    # because both have an outgoing edge to "fusion").
    g.add_edge("dense", "fusion")
    g.add_edge("bm25", "fusion")
    g.add_edge("fusion", "generation")
    g.add_edge("generation", END)
    return g.compile()


code_query_graph = build_code_query_graph()


def build_code_retrieval_graph():
    g = StateGraph(CodeQueryState)
    g.add_node("prepare", prepare_code_query)
    g.add_node("decompose", decompose_query_node)
    g.add_node("classify", code_classify_node)
    g.add_node("graph_query", graph_query_node)
    g.add_node("dense", code_dense_node)
    g.add_node("bm25", code_bm25_node)
    g.add_node("fusion", code_fusion_node)
    g.add_node("ready", _code_ready)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "decompose")
    g.add_edge("decompose", "classify")
    g.add_edge("classify", "graph_query")
    g.add_edge("graph_query", "dense")
    g.add_edge("graph_query", "bm25")
    g.add_edge("dense", "fusion")
    g.add_edge("bm25", "fusion")
    g.add_edge("fusion", "ready")
    g.add_edge("ready", END)
    return g.compile()


code_retrieval_graph = build_code_retrieval_graph()

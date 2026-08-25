from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from src.nodes.retrieval.code_classify import code_classify_node
from src.nodes.retrieval.code_dense import code_dense_node
from src.nodes.retrieval.generation import generation_node
from src.nodes.retrieval.graph_query import graph_query_node


class CodeQueryState(TypedDict, total=False):
    query: str
    primary_query: str
    top_k: int
    repo_id: str
    code_intent: str
    graph_hits: list[dict]
    focus_files: list[str]
    dense_results: list[Any]
    reranked_results: list[Any]     # kept for compatibility with generation_node
    compressed_results: list[Any]
    fused_results: list[Any]
    answer: str
    complexity: str


def prepare_code_query(state: dict) -> dict:
    return {
        "primary_query": state["query"],
        "complexity": "complex",     # generation_node picks generate_complex tier
    }


def _code_ready(_state: dict) -> dict:
    """No-op join point — retrieval done, caller does its own single
    generation/stream so we don't pay for generation twice."""
    return {}


def build_code_query_graph():
    g = StateGraph(CodeQueryState)
    g.add_node("prepare", prepare_code_query)
    g.add_node("classify", code_classify_node)
    g.add_node("graph_query", graph_query_node)
    g.add_node("dense", code_dense_node)
    g.add_node("generation", generation_node)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "classify")
    g.add_edge("classify", "graph_query")
    g.add_edge("graph_query", "dense")
    g.add_edge("dense", "generation")
    g.add_edge("generation", END)
    return g.compile()


code_query_graph = build_code_query_graph()

def build_code_retrieval_graph():
    g = StateGraph(CodeQueryState)
    g.add_node("prepare", prepare_code_query)
    g.add_node("classify", code_classify_node)
    g.add_node("graph_query", graph_query_node)
    g.add_node("dense", code_dense_node)
    g.add_node("ready", _code_ready)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "classify")
    g.add_edge("classify", "graph_query")
    g.add_edge("graph_query", "dense")
    g.add_edge("dense", "ready")
    g.add_edge("ready", END)
    return g.compile()


code_retrieval_graph = build_code_retrieval_graph()
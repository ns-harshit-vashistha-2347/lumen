from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from src.nodes.ingestion.code_embed import code_embed_node
from src.nodes.ingestion.code_parse import code_parse_node
from src.nodes.ingestion.code_store import code_store_node
from src.nodes.ingestion.graph_build import graph_build_node


class CodeIngestionState(TypedDict, total=False):
    repo_id: str
    user_id: str
    clone_path: str
    head_sha: str
    files: list[Any]
    chunks: list[Any]
    embeddings: list[list[float]]
    stored_chunk_count: int
    graph_symbols: int
    graph_edges: int


def build_code_ingestion_graph():
    g = StateGraph(CodeIngestionState)
    g.add_node("parse", code_parse_node)
    g.add_node("embed", code_embed_node)
    g.add_node("store", code_store_node)
    g.add_node("graph_build", graph_build_node)

    g.add_edge(START, "parse")
    g.add_edge("parse", "embed")
    g.add_edge("embed", "store")
    g.add_edge("store", "graph_build")
    g.add_edge("graph_build", END)
    return g.compile()


code_ingestion_graph = build_code_ingestion_graph()
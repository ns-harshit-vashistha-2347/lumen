"""Cypher queries against the per-repo Kuzu graph."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from src.core.config import settings
from src.core.kuzu_client import kuzu_connection, kuzu_path
from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class SymbolHit:
    id: str
    name: str
    kind: str
    file_path: str
    start_line: int
    end_line: int


def _rows(result) -> list[dict]:
    out = []
    while result.has_next():
        out.append(result.get_next())
    return out


def graph_available(repo_id: str) -> bool:
    return kuzu_path(repo_id).exists()


def find_symbols(repo_id: str, name: str, limit: int | None = None) -> list[SymbolHit]:
    """Case-insensitive substring match on symbol name."""
    if not graph_available(repo_id):
        return []
    limit = limit or settings.CODE_GRAPH_MAX_SYMBOL_MATCHES
    q = (
        "MATCH (s:Symbol) "
        "WHERE lower(s.name) CONTAINS lower($n) AND s.kind <> 'unresolved' "
        "RETURN s.id, s.name, s.kind, s.file_path, s.start_line, s.end_line "
        "LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"n": name, "lim": limit}))
    return [
        SymbolHit(id=r[0], name=r[1], kind=r[2], file_path=r[3], start_line=r[4], end_line=r[5])
        for r in rows
    ]


def callers_of(repo_id: str, symbol_name: str, limit: int = 25) -> list[SymbolHit]:
    if not graph_available(repo_id):
        return []
    q = (
        "MATCH (caller:Symbol)-[:CALLS]->(target:Symbol) "
        "WHERE lower(target.name) = lower($n) "
        "RETURN DISTINCT caller.id, caller.name, caller.kind, caller.file_path, "
        "caller.start_line, caller.end_line LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"n": symbol_name, "lim": limit}))
    return [SymbolHit(*r) for r in rows]


def callees_of(repo_id: str, symbol_name: str, limit: int = 25) -> list[SymbolHit]:
    if not graph_available(repo_id):
        return []
    q = (
        "MATCH (caller:Symbol)-[:CALLS]->(callee:Symbol) "
        "WHERE lower(caller.name) = lower($n) AND callee.kind <> 'unresolved' "
        "RETURN DISTINCT callee.id, callee.name, callee.kind, callee.file_path, "
        "callee.start_line, callee.end_line LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"n": symbol_name, "lim": limit}))
    return [SymbolHit(*r) for r in rows]


def importers_of(repo_id: str, file_path: str, limit: int = 50) -> list[str]:
    """Files that import file_path."""
    if not graph_available(repo_id):
        return []
    q = (
        "MATCH (a:File)-[:IMPORTS]->(b:File) WHERE b.path = $p "
        "RETURN a.path LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"p": file_path, "lim": limit}))
    return [r[0] for r in rows]


def imports_from(repo_id: str, file_path: str, limit: int = 50) -> dict:
    """Files + external modules imported by file_path."""
    if not graph_available(repo_id):
        return {"files": [], "modules": []}
    with kuzu_connection(repo_id, create=False) as conn:
        files = _rows(conn.execute(
            "MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.path = $p RETURN b.path LIMIT $lim",
            {"p": file_path, "lim": limit},
        ))
        mods = _rows(conn.execute(
            "MATCH (a:File)-[:IMPORTS_MODULE]->(m:Module) WHERE a.path = $p "
            "RETURN m.name LIMIT $lim",
            {"p": file_path, "lim": limit},
        ))
    return {"files": [r[0] for r in files], "modules": [r[0] for r in mods]}


def graph_stats(repo_id: str) -> dict:
    if not graph_available(repo_id):
        return {"available": False, "files": 0, "symbols": 0, "calls": 0, "imports": 0}
    with kuzu_connection(repo_id, create=False) as conn:
        def _count(q: str) -> int:
            rows = _rows(conn.execute(q))
            return int(rows[0][0]) if rows else 0
        files = _count("MATCH (f:File) RETURN count(f)")
        symbols = _count("MATCH (s:Symbol) WHERE s.kind <> 'unresolved' RETURN count(s)")
        calls = _count("MATCH ()-[r:CALLS]->() RETURN count(r)")
        imports = _count("MATCH ()-[r:IMPORTS]->() RETURN count(r)")
    return {"available": True, "files": files, "symbols": symbols, "calls": calls, "imports": imports}


def list_files(repo_id: str, query: str = "", limit: int = 100, offset: int = 0) -> list[dict]:
    if not graph_available(repo_id):
        return []
    q = (
        "MATCH (f:File) "
        "WHERE ($q = '' OR lower(f.path) CONTAINS lower($q)) "
        "OPTIONAL MATCH (f)-[:DEFINES]->(s:Symbol) "
        "WITH f, count(s) AS n "
        "RETURN f.path, f.language, n "
        "ORDER BY f.path SKIP $off LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"q": query, "lim": limit, "off": offset}))
    return [{"path": r[0], "language": r[1], "symbol_count": int(r[2])} for r in rows]


def list_symbols(
    repo_id: str,
    query: str = "",
    file: str = "",
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    if not graph_available(repo_id):
        return []
    q = (
        "MATCH (s:Symbol) "
        "WHERE s.kind <> 'unresolved' "
        "AND ($q = '' OR lower(s.name) CONTAINS lower($q)) "
        "AND ($f = '' OR s.file_path = $f) "
        "RETURN s.id, s.name, s.kind, s.file_path, s.start_line, s.end_line "
        "ORDER BY s.name SKIP $off LIMIT $lim"
    )
    with kuzu_connection(repo_id, create=False) as conn:
        rows = _rows(conn.execute(q, {"q": query, "f": file, "lim": limit, "off": offset}))
    return [
        {"id": r[0], "name": r[1], "kind": r[2], "file_path": r[3],
         "start_line": r[4], "end_line": r[5]}
        for r in rows
    ]


def calls_subgraph(repo_id: str, limit: int = 120) -> dict:
    """Top-N most connected symbols and every CALLS edge among them.
    Shape: {nodes:[{id,label,kind,file,degree}], edges:[{source,target,type}]}"""
    if not graph_available(repo_id):
        return {"nodes": [], "edges": []}
    limit = max(5, min(limit, 400))
    with kuzu_connection(repo_id, create=False) as conn:
        # Rank symbols by call-degree (in + out).
        rank_q = (
            "MATCH (s:Symbol) "
            "WHERE s.kind <> 'unresolved' "
            "OPTIONAL MATCH (s)-[o:CALLS]->() "
            "OPTIONAL MATCH ()-[i:CALLS]->(s) "
            "WITH s, count(DISTINCT o) + count(DISTINCT i) AS deg "
            "WHERE deg > 0 "
            "RETURN s.id, s.name, s.kind, s.file_path, deg "
            "ORDER BY deg DESC LIMIT $lim"
        )
        rows = _rows(conn.execute(rank_q, {"lim": limit}))
        nodes = [
            {"id": r[0], "label": r[1], "kind": r[2],
             "file": r[3], "degree": int(r[4])}
            for r in rows
        ]
        ids = [n["id"] for n in nodes]
        edges: list[dict] = []
        if ids:
            edge_q = (
                "MATCH (a:Symbol)-[:CALLS]->(b:Symbol) "
                "WHERE a.id IN $ids AND b.id IN $ids "
                "RETURN a.id, b.id"
            )
            for r in _rows(conn.execute(edge_q, {"ids": ids})):
                edges.append({"source": r[0], "target": r[1], "type": "CALLS"})
    return {"nodes": nodes, "edges": edges}


def imports_subgraph(repo_id: str, limit: int = 120) -> dict:
    """Top-N files by import-degree and every IMPORTS edge among them."""
    if not graph_available(repo_id):
        return {"nodes": [], "edges": []}
    limit = max(5, min(limit, 400))
    with kuzu_connection(repo_id, create=False) as conn:
        rank_q = (
            "MATCH (f:File) "
            "OPTIONAL MATCH (f)-[o:IMPORTS]->() "
            "OPTIONAL MATCH ()-[i:IMPORTS]->(f) "
            "WITH f, count(DISTINCT o) + count(DISTINCT i) AS deg "
            "WHERE deg > 0 "
            "RETURN f.path, f.language, deg "
            "ORDER BY deg DESC LIMIT $lim"
        )
        rows = _rows(conn.execute(rank_q, {"lim": limit}))
        nodes = [
            {"id": r[0], "label": r[0].rsplit("/", 1)[-1],
             "kind": r[1] or "file", "file": r[0], "degree": int(r[2])}
            for r in rows
        ]
        ids = [n["id"] for n in nodes]
        edges: list[dict] = []
        if ids:
            edge_q = (
                "MATCH (a:File)-[:IMPORTS]->(b:File) "
                "WHERE a.path IN $ids AND b.path IN $ids "
                "RETURN a.path, b.path"
            )
            for r in _rows(conn.execute(edge_q, {"ids": ids})):
                edges.append({"source": r[0], "target": r[1], "type": "IMPORTS"})
    return {"nodes": nodes, "edges": edges}


def calls_ego(repo_id: str, node_id: str, direction: str = "out", limit: int = 50) -> dict:
    """Immediate neighborhood of a Symbol via CALLS. direction: out|in|both."""
    if not graph_available(repo_id):
        return {"nodes": [], "edges": []}
    limit = max(1, min(limit, 200))
    with kuzu_connection(repo_id, create=False) as conn:
        root_rows = _rows(conn.execute(
            "MATCH (s:Symbol) WHERE s.id = $id "
            "RETURN s.id, s.name, s.kind, s.file_path",
            {"id": node_id},
        ))
        if not root_rows:
            return {"nodes": [], "edges": []}
        r = root_rows[0]
        nodes: dict[str, dict] = {
            r[0]: {"id": r[0], "label": r[1], "kind": r[2], "file": r[3], "degree": 0},
        }
        edges: list[dict] = []
        if direction in ("out", "both"):
            for row in _rows(conn.execute(
                "MATCH (a:Symbol)-[:CALLS]->(b:Symbol) "
                "WHERE a.id = $id AND b.kind <> 'unresolved' "
                "RETURN b.id, b.name, b.kind, b.file_path LIMIT $lim",
                {"id": node_id, "lim": limit},
            )):
                nodes.setdefault(row[0], {"id": row[0], "label": row[1], "kind": row[2], "file": row[3], "degree": 0})
                edges.append({"source": node_id, "target": row[0], "type": "CALLS"})
        if direction in ("in", "both"):
            for row in _rows(conn.execute(
                "MATCH (a:Symbol)-[:CALLS]->(b:Symbol) "
                "WHERE b.id = $id "
                "RETURN a.id, a.name, a.kind, a.file_path LIMIT $lim",
                {"id": node_id, "lim": limit},
            )):
                nodes.setdefault(row[0], {"id": row[0], "label": row[1], "kind": row[2], "file": row[3], "degree": 0})
                edges.append({"source": row[0], "target": node_id, "type": "CALLS"})
    for e in edges:
        nodes[e["source"]]["degree"] += 1
        nodes[e["target"]]["degree"] += 1
    return {"nodes": list(nodes.values()), "edges": edges}


def imports_ego(repo_id: str, path: str, direction: str = "out", limit: int = 50) -> dict:
    """Immediate neighborhood of a File via IMPORTS."""
    if not graph_available(repo_id):
        return {"nodes": [], "edges": []}
    limit = max(1, min(limit, 200))
    with kuzu_connection(repo_id, create=False) as conn:
        root_rows = _rows(conn.execute(
            "MATCH (f:File) WHERE f.path = $p RETURN f.path, f.language",
            {"p": path},
        ))
        if not root_rows:
            return {"nodes": [], "edges": []}
        r = root_rows[0]
        nodes: dict[str, dict] = {
            r[0]: {"id": r[0], "label": r[0].rsplit("/", 1)[-1], "kind": r[1] or "file",
                   "file": r[0], "degree": 0},
        }
        edges: list[dict] = []
        if direction in ("out", "both"):
            for row in _rows(conn.execute(
                "MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.path = $p "
                "RETURN b.path, b.language LIMIT $lim",
                {"p": path, "lim": limit},
            )):
                nodes.setdefault(row[0], {"id": row[0], "label": row[0].rsplit("/", 1)[-1],
                                          "kind": row[1] or "file", "file": row[0], "degree": 0})
                edges.append({"source": path, "target": row[0], "type": "IMPORTS"})
        if direction in ("in", "both"):
            for row in _rows(conn.execute(
                "MATCH (a:File)-[:IMPORTS]->(b:File) WHERE b.path = $p "
                "RETURN a.path, a.language LIMIT $lim",
                {"p": path, "lim": limit},
            )):
                nodes.setdefault(row[0], {"id": row[0], "label": row[0].rsplit("/", 1)[-1],
                                          "kind": row[1] or "file", "file": row[0], "degree": 0})
                edges.append({"source": row[0], "target": path, "type": "IMPORTS"})
    for e in edges:
        nodes[e["source"]]["degree"] += 1
        nodes[e["target"]]["degree"] += 1
    return {"nodes": list(nodes.values()), "edges": edges}


def graph_query_node(state: dict) -> dict:
    """LangGraph node: dispatch based on state['code_intent'] populated by
    the classifier. Returns state['graph_hits'] — list of {path, snippet_hint}
    that the retriever will use to bias / seed dense retrieval."""
    repo_id = state["repo_id"]
    intent = state.get("code_intent", "behavior")
    query = state.get("primary_query") or state["query"]

    hits: list[dict] = []
    focus_files: set[str] = set()

    if intent == "symbol":
        symbols = find_symbols(repo_id, _extract_symbol_hint(query))
        for s in symbols:
            hits.append({
                "kind": "symbol",
                "path": s.file_path,
                "symbol": s.name,
                "symbol_kind": s.kind,
                "start_line": s.start_line,
                "end_line": s.end_line,
            })
            focus_files.add(s.file_path)

    elif intent == "dependency":
        name = _extract_symbol_hint(query)
        for s in callers_of(repo_id, name):
            hits.append({
                "kind": "caller", "path": s.file_path, "symbol": s.name,
                "symbol_kind": s.kind, "start_line": s.start_line, "end_line": s.end_line,
            })
            focus_files.add(s.file_path)
        for s in callees_of(repo_id, name):
            hits.append({
                "kind": "callee", "path": s.file_path, "symbol": s.name,
                "symbol_kind": s.kind, "start_line": s.start_line, "end_line": s.end_line,
            })
            focus_files.add(s.file_path)

    # For behavior/general we intentionally return no graph hits — dense
    # retrieval alone answers those better.

    logger.info(f"[graph_query] intent={intent} hits={len(hits)} focus_files={len(focus_files)}")
    return {"graph_hits": hits, "focus_files": list(focus_files)}


def _extract_symbol_hint(query: str) -> str:
    """Very simple heuristic: pull the longest identifier-looking token
    (letters/digits/_ with at least one letter). Good enough for questions
    like 'where is FooBar defined?' or 'who calls process_batch?'."""
    import re
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", query)
    if not tokens:
        return query.strip()
    # Prefer CamelCase or snake_case tokens over plain words
    tokens.sort(key=lambda t: (
        (any(c.isupper() for c in t[1:]) or "_" in t),   # CamelCase / snake_case first
        len(t),
    ), reverse=True)
    return tokens[0]
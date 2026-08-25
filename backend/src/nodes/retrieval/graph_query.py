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
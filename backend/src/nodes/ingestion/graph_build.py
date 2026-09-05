"""Extract symbols / imports / calls from the AST and persist them into
the per-repo Kuzu graph.

Coverage:
- Symbols (functions, classes, methods) for Python, JS/TS, Go, Java, Rust
- Imports (best-effort resolution to files) for Python + JS/TS
- Calls (name-based, best-effort) for Python + JS/TS

Resolution is intentionally simple and local — we prefer "roughly right and
fast" over "perfect and slow". Anything we can't resolve becomes an
IMPORTS_MODULE (external module name) or CALLS_UNRESOLVED (callee name only)
edge, so nothing is silently dropped.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Optional
from src.nodes.ingestion.import_resolvers import (
    ResolverContext, build_context, resolve_python, resolve_js,
)

from src.core.kuzu_client import (
    delete_paths_from_graph, kuzu_connection, reset_repo_graph,
)
from src.core.logging import get_logger
from src.nodes.ingestion.code_parse import SYMBOL_NODE_TYPES, TS_LANG_KEY, _get_parser

logger = get_logger(__name__)


# --- data classes -----------------------------------------------------------

class _Sym:
    __slots__ = ("id", "name", "kind", "file_path", "start_line", "end_line")
    def __init__(self, name: str, kind: str, file_path: str, start: int, end: int):
        self.id = str(uuid.uuid4())
        self.name = name
        self.kind = kind
        self.file_path = file_path
        self.start_line = start
        self.end_line = end


# --- import extraction ------------------------------------------------------

def _py_imports(root, source: bytes) -> list[str]:
    """Return raw dotted-module names from `import x` / `from x import y`."""
    out: list[str] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type == "import_statement":
            for name_node in n.children:
                if name_node.type == "dotted_name":
                    out.append(source[name_node.start_byte:name_node.end_byte].decode())
        elif n.type == "import_from_statement":
            mod_node = n.child_by_field_name("module_name")
            if mod_node is not None:
                out.append(source[mod_node.start_byte:mod_node.end_byte].decode())
        for c in n.children:
            stack.append(c)
    return out


def _js_imports(root, source: bytes) -> list[str]:
    """Return raw specifier strings from `import ... from 'x'` and
    `require('x')`."""
    out: list[str] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type in ("import_statement", "import_declaration"):
            src_node = n.child_by_field_name("source")
            if src_node is not None:
                raw = source[src_node.start_byte:src_node.end_byte].decode()
                out.append(raw.strip("'\""))
        elif n.type == "call_expression":
            fn_node = n.child_by_field_name("function")
            if fn_node is not None:
                fn_name = source[fn_node.start_byte:fn_node.end_byte].decode()
                if fn_name == "require":
                    args = n.child_by_field_name("arguments")
                    if args is not None:
                        for c in args.children:
                            if c.type == "string":
                                out.append(source[c.start_byte:c.end_byte].decode().strip("'\""))
        for c in n.children:
            stack.append(c)
    return out


# --- call extraction --------------------------------------------------------

def _call_sites(root, source: bytes) -> list[tuple[str, str | None]]:
    """Return [(callee_name, receiver_or_None), ...] for every call site."""
    out: list[tuple[str, str | None]] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type in ("call", "call_expression"):
            fn_node = n.child_by_field_name("function")
            if fn_node is not None:
                if fn_node.type == "identifier":
                    out.append((source[fn_node.start_byte:fn_node.end_byte].decode(), None))
                elif fn_node.type in ("attribute", "member_expression"):
                    prop = fn_node.child_by_field_name("attribute") or fn_node.child_by_field_name("property")
                    recv = fn_node.child_by_field_name("object")
                    name = source[prop.start_byte:prop.end_byte].decode() if prop else None
                    recv_name = source[recv.start_byte:recv.end_byte].decode() if recv and recv.type == "identifier" else None
                    if name:
                        out.append((name, recv_name))
        for c in n.children:
            stack.append(c)
    return out


# --- main graph build -------------------------------------------------------

def _extract_from_file(fe, ctx: ResolverContext):
    """Return (symbols, resolved_imports, external_modules, calls_by_symbol).
    calls_by_symbol maps parent-symbol-id -> list[callee_name]."""
    lang = fe.language
    if lang not in TS_LANG_KEY:
        return [], [], [], {}

    parser = _get_parser(lang)
    if parser is None:
        return [], [], [], {}

    try:
        source = fe.path.read_bytes()
    except OSError:
        return [], [], [], {}

    tree = parser.parse(source)
    root = tree.root_node

    # Symbols
    symbol_types = SYMBOL_NODE_TYPES.get(lang, set())
    symbols: list[_Sym] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type in symbol_types:
            name_node = n.child_by_field_name("name")
            if name_node is not None:
                name = source[name_node.start_byte:name_node.end_byte].decode(errors="replace")
                symbols.append(_Sym(
                    name=name, kind=n.type, file_path=fe.rel_path,
                    start=n.start_point[0] + 1, end=n.end_point[0] + 1,
                ))
        for c in n.children:
            stack.append(c)

    # Imports
    resolved: list[str] = []
    external: list[str] = []
    if lang == "python":
        for mod in _py_imports(root, source):
            r = resolve_python(mod, ctx)
            if r: resolved.append(r)
            else: external.append(mod)

    elif lang in ("javascript", "typescript", "tsx"):
        for spec in _js_imports(root, source):
            r = resolve_js(spec, fe.rel_path, ctx)
            if r: resolved.append(r)
            else: external.append(spec)

    # Calls per symbol (only Python + JS/TS)
    calls_by_sym: dict[str, list[str]] = {}
    if lang in ("python", "javascript", "typescript", "tsx"):
        # Reparse per symbol subtree using byte ranges
        for sym in symbols:
            # find the node again by matching line range — cheap enough
            node = _find_node_at(root, sym.start_line - 1, sym.end_line - 1, symbol_types)
            if node is not None:
                calls_by_sym[sym.id] = _call_sites(node, source)

    return symbols, resolved, external, calls_by_sym


def _find_node_at(root, start_row: int, end_row: int, types: set[str]):
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type in types and n.start_point[0] == start_row and n.end_point[0] == end_row:
            return n
        for c in n.children:
            stack.append(c)
    return None


def graph_build_node(state: dict) -> dict:
    repo_id: str = state["repo_id"]
    files = state["files"]
    # Incremental mode: reindex passes only the changed subset plus a list
    # of removed paths. We prune the affected file/symbol subgraph first,
    # then re-add just the changed files. Full-build mode (initial ingest)
    # wipes and rebuilds — the default.
    incremental: bool = bool(state.get("incremental"))
    removed_paths: list[str] = list(state.get("removed_paths") or [])

    # Only bother for languages with tree-sitter grammars
    files = [f for f in files if f.language in TS_LANG_KEY]
    if not files and not removed_paths:
        logger.info(f"[graph_build] repo={repo_id} no supported languages; skipping")
        return {"graph_symbols": 0, "graph_edges": 0}

    all_paths = {f.rel_path for f in files}

    # Extract everything first (in-memory), then bulk insert
    all_symbols: list[_Sym] = []
    imports_resolved: list[tuple[str, str]] = []       # (from_file, to_file)
    imports_external: list[tuple[str, str]] = []       # (from_file, module)
    # (caller_sym_id, callee_name, receiver_or_None, caller_file)
    calls_pending: list[tuple[str, str, str | None, str]] = []

    clone_root = Path(state["clone_path"])
    ctx = build_context(clone_root, {f.rel_path for f in files})
    logger.info(
        f"[graph_build] resolver ctx ts_base={ctx.ts_base_url!r} "
        f"ts_paths={len(ctx.ts_paths)} py_roots={ctx.py_source_roots}"
    )

    for fe in files:
        syms, resolved, external, calls_by_sym = _extract_from_file(fe, ctx)

        all_symbols.extend(syms)
        for r in resolved:
            imports_resolved.append((fe.rel_path, r))
        for e in external:
            imports_external.append((fe.rel_path, e))
        for sym_id, callees in calls_by_sym.items():
            for name, recv in callees:
                calls_pending.append((sym_id, name, recv, fe.rel_path))

    # Resolve calls: prefer symbol in same file, else any symbol in repo with that name
    by_name_local: dict[tuple[str, str], _Sym] = {(s.file_path, s.name): s for s in all_symbols}
    by_name_global: dict[str, list[_Sym]] = defaultdict(list)
    for s in all_symbols:
        by_name_global[s.name].append(s)

    resolved_calls: list[tuple[str, str]] = []   # (caller_id, callee_id)
    unresolved_calls: list[tuple[str, str]] = [] # (caller_id, callee_name)
    for caller_id, name, _recv, caller_file in calls_pending:
        local = by_name_local.get((caller_file, name))
        if local:
            resolved_calls.append((caller_id, local.id))
            continue
        candidates = by_name_global.get(name, [])
        if len(candidates) == 1:
            resolved_calls.append((caller_id, candidates[0].id))
        else:
            unresolved_calls.append((caller_id, name))

    # --- persist -----------------------------------------------------------
    if incremental:
        # Prune the affected subgraph: the incoming changed files' current
        # nodes/edges, plus any files the diff reported as removed.
        prune_targets = list({fe.rel_path for fe in files} | set(removed_paths))
        delete_paths_from_graph(repo_id, prune_targets)
    else:
        reset_repo_graph(repo_id)
    with kuzu_connection(repo_id) as conn:
        # Files
        for fe in files:
            conn.execute(
                "MERGE (:File {path: $p, language: $l})",
                {"p": fe.rel_path, "l": fe.language or ""},
            )
        # Symbols
        for s in all_symbols:
            conn.execute(
                "CREATE (:Symbol {id: $id, name: $n, kind: $k, file_path: $f, "
                "start_line: $sl, end_line: $el})",
                {"id": s.id, "n": s.name, "k": s.kind, "f": s.file_path,
                 "sl": s.start_line, "el": s.end_line},
            )
        # DEFINES
        for s in all_symbols:
            conn.execute(
                "MATCH (f:File {path: $fp}), (sy:Symbol {id: $sid}) CREATE (f)-[:DEFINES]->(sy)",
                {"fp": s.file_path, "sid": s.id},
            )
        # IMPORTS (file->file)
        for src, dst in imports_resolved:
            conn.execute(
                "MATCH (a:File {path: $s}), (b:File {path: $d}) CREATE (a)-[:IMPORTS]->(b)",
                {"s": src, "d": dst},
            )
        # External modules
        for src, mod in imports_external:
            conn.execute("MERGE (:Module {name: $m})", {"m": mod})
            conn.execute(
                "MATCH (a:File {path: $s}), (m:Module {name: $mod}) "
                "CREATE (a)-[:IMPORTS_MODULE {alias: ''}]->(m)",
                {"s": src, "mod": mod},
            )
        # CALLS
        for caller_id, callee_id in resolved_calls:
            conn.execute(
                "MATCH (a:Symbol {id: $a}), (b:Symbol {id: $b}) "
                "CREATE (a)-[:CALLS {count: 1}]->(b)",
                {"a": caller_id, "b": callee_id},
            )
        # For unresolved calls we still record them, pointing to a synthetic
        # placeholder Symbol keyed by name (so "who calls foo?" can find them).
        placeholder_ids: dict[str, str] = {}
        for _, name in unresolved_calls:
            if name not in placeholder_ids:
                pid = f"__unresolved__:{name}"
                placeholder_ids[name] = pid
                conn.execute(
                    "MERGE (:Symbol {id: $id, name: $n, kind: 'unresolved', "
                    "file_path: '', start_line: 0, end_line: 0})",
                    {"id": pid, "n": name},
                )
        for caller_id, name in unresolved_calls:
            conn.execute(
                "MATCH (a:Symbol {id: $a}), (b:Symbol {id: $b}) "
                "CREATE (a)-[:CALLS_UNRESOLVED {count: 1}]->(b)",
                {"a": caller_id, "b": placeholder_ids[name]},
            )

    edge_count = len(imports_resolved) + len(imports_external) + len(resolved_calls) + len(unresolved_calls) + len(all_symbols)
    logger.info(
        f"[graph_build] repo={repo_id} symbols={len(all_symbols)} "
        f"imports={len(imports_resolved)} external={len(imports_external)} "
        f"calls_resolved={len(resolved_calls)} calls_unresolved={len(unresolved_calls)}"
    )
    return {"graph_symbols": len(all_symbols), "graph_edges": edge_count}
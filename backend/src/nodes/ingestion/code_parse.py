from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Optional

from src.core.logging import get_logger

logger = get_logger(__name__)


SYMBOL_NODE_TYPES: dict[str, set[str]] = {
    "python":     {"function_definition", "class_definition"},
    "javascript": {"function_declaration", "class_declaration", "method_definition",
                   "generator_function_declaration"},
    "typescript": {"function_declaration", "class_declaration", "method_definition",
                   "interface_declaration", "enum_declaration",
                   "abstract_class_declaration"},
    "tsx":        {"function_declaration", "class_declaration", "method_definition",
                   "interface_declaration", "enum_declaration"},
    "go":         {"function_declaration", "method_declaration", "type_declaration"},
    "java":       {"method_declaration", "class_declaration", "interface_declaration"},
    "rust":       {"function_item", "impl_item", "struct_item", "enum_item", "trait_item"},
}

# Node types that act as *containers* (classes, impl blocks, interfaces): if we
# already emit their children as separate symbol chunks, we skip re-emitting
# the whole container body — that would duplicate every method into two chunks
# and dilute the embedding signal.
CONTAINER_NODE_TYPES: dict[str, set[str]] = {
    "python":     {"class_definition"},
    "javascript": {"class_declaration"},
    "typescript": {"class_declaration", "interface_declaration", "abstract_class_declaration"},
    "tsx":        {"class_declaration", "interface_declaration"},
    "java":       {"class_declaration", "interface_declaration"},
    "rust":       {"impl_item", "trait_item"},
}


TS_LANG_KEY = {
    "python": "python", "javascript": "javascript",
    "typescript": "typescript", "tsx": "tsx",
    "go": "go", "java": "java", "rust": "rust",
}


FALLBACK_LINES = 80
FALLBACK_OVERLAP = 10

# Cap on lines per chunk. Symbols larger than this are windowed so a single
# 2000-line class doesn't produce one embedding that averages away all detail.
MAX_SYMBOL_LINES = 120
SYMBOL_WINDOW_OVERLAP = 15


@dataclass
class CodeChunk:
    content: str
    rel_path: str
    language: str
    symbol_name: Optional[str]
    symbol_kind: Optional[str]
    start_line: int
    end_line: int


def _read_text(path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
    except OSError:
        return None


def _header(rel_path: str, language: str, kind: Optional[str], name: Optional[str],
            start: int, end: int) -> str:
    """A short, embedder-visible preamble. Puts the identifiers a code-tuned
    embedder cares about (file path, symbol name, kind) at the top of every
    chunk so dense retrieval matches on them."""
    label = " ".join(x for x in (kind, name) if x) or "chunk"
    return f"# {rel_path}:{start}-{end}  [{language}]  {label}\n"


def _emit(content: str, rel_path: str, language: str, kind: Optional[str],
          name: Optional[str], start: int, end: int) -> Iterator[CodeChunk]:
    """Emit one chunk, splitting oversized bodies into windows that share the
    same header so each window still carries symbol context."""
    lines = content.splitlines()
    if not lines:
        return
    if len(lines) <= MAX_SYMBOL_LINES:
        yield CodeChunk(
            content=_header(rel_path, language, kind, name, start, end) + content,
            rel_path=rel_path, language=language,
            symbol_name=name, symbol_kind=kind,
            start_line=start, end_line=end,
        )
        return

    step = max(1, MAX_SYMBOL_LINES - SYMBOL_WINDOW_OVERLAP)
    for offset in range(0, len(lines), step):
        window = lines[offset:offset + MAX_SYMBOL_LINES]
        if not window:
            break
        w_start = start + offset
        w_end = w_start + len(window) - 1
        yield CodeChunk(
            content=_header(rel_path, language, kind, name, w_start, w_end) + "\n".join(window),
            rel_path=rel_path, language=language,
            symbol_name=name, symbol_kind=kind,
            start_line=w_start, end_line=w_end,
        )
        if offset + MAX_SYMBOL_LINES >= len(lines):
            break


def _fallback_chunks(text: str, rel_path: str, language: str) -> Iterator[CodeChunk]:
    lines = text.splitlines()
    n = len(lines)
    if n == 0:
        return
    step = max(1, FALLBACK_LINES - FALLBACK_OVERLAP)
    for start in range(0, n, step):
        end = min(n, start + FALLBACK_LINES)
        yield from _emit(
            "\n".join(lines[start:end]),
            rel_path=rel_path, language=language,
            kind=None, name=None,
            start=start + 1, end=end,
        )
        if end == n:
            break


def _get_parser(language: str):
    key = TS_LANG_KEY.get(language)
    if not key:
        return None
    try:
        from tree_sitter_language_pack import get_parser
        return get_parser(key)
    except Exception as exc:
        logger.warning(f"[code_parse] tree-sitter parser unavailable for {language}: {exc}")
        return None


def _node_name(node, source: bytes) -> Optional[str]:
    """Best-effort: look for a child named 'name'."""
    try:
        name_node = node.child_by_field_name("name")
        if name_node is not None:
            return source[name_node.start_byte:name_node.end_byte].decode("utf-8", errors="replace")
    except Exception:
        pass
    # Rust impl_item has no `name` field; return first identifier-ish child
    for child in getattr(node, "children", []) or []:
        if child.type in ("identifier", "type_identifier"):
            return source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return None


def _container_summary(node, source: bytes, language: str) -> Optional[str]:
    """For a class/interface/impl block, return just the signature line +
    docstring (if any) — the body's methods are emitted as their own chunks."""
    try:
        first = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace").splitlines()
    except Exception:
        return None
    # Signature line: everything up to the first `:` (Python), `{` (JS/TS/Java/Rust), or newline.
    if not first:
        return None
    sig = first[0]
    # Optional python-style docstring: peek first non-empty following line
    doc = ""
    for line in first[1:8]:
        stripped = line.strip()
        if stripped and (stripped.startswith('"""') or stripped.startswith("'''") or stripped.startswith("///")):
            doc = "\n" + stripped
            break
    return sig + doc


def _ast_chunks(text: str, rel_path: str, language: str) -> Iterator[CodeChunk]:
    parser = _get_parser(language)
    if parser is None:
        yield from _fallback_chunks(text, rel_path, language)
        return

    symbol_types = SYMBOL_NODE_TYPES.get(language, set())
    container_types = CONTAINER_NODE_TYPES.get(language, set())
    if not symbol_types:
        yield from _fallback_chunks(text, rel_path, language)
        return

    source = text.encode("utf-8")
    tree = parser.parse(source)

    emitted_any = False
    # Two-pass DFS: first identify which container nodes have symbol children,
    # so we can emit a short "signature-only" chunk for those instead of the
    # whole body (its methods will be emitted separately). Iterative DFS.
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type in symbol_types:
            name = _node_name(node, source)
            start = node.start_point[0] + 1
            end = node.end_point[0] + 1

            if node.type in container_types and _has_symbol_descendant(node, symbol_types):
                # Container with methods → emit only signature/docstring; the
                # methods themselves come through on subsequent pops.
                summary = _container_summary(node, source, language)
                if summary and summary.strip():
                    yield from _emit(
                        summary, rel_path, language,
                        kind=node.type, name=name,
                        start=start, end=start + summary.count("\n"),
                    )
                    emitted_any = True
            else:
                content = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                if content.strip():
                    yield from _emit(
                        content, rel_path, language,
                        kind=node.type, name=name,
                        start=start, end=end,
                    )
                    emitted_any = True
            # Still descend for nested symbols (methods inside a class)
        for child in reversed(getattr(node, "children", []) or []):
            stack.append(child)

    if not emitted_any:
        # e.g. a file of only imports / constants — fall back to lines
        yield from _fallback_chunks(text, rel_path, language)


def _has_symbol_descendant(node, symbol_types: set[str]) -> bool:
    """Non-recursive DFS: does any descendant of `node` (excluding node itself)
    match one of the symbol node types?"""
    stack = list(getattr(node, "children", []) or [])
    while stack:
        n = stack.pop()
        if n.type in symbol_types:
            return True
        stack.extend(getattr(n, "children", []) or [])
    return False


def parse_file(file_entry) -> list[CodeChunk]:
    text = _read_text(file_entry.path)
    if text is None or not text.strip():
        return []
    lang = file_entry.language or "text"
    if lang in TS_LANG_KEY:
        return list(_ast_chunks(text, file_entry.rel_path, lang))
    return list(_fallback_chunks(text, file_entry.rel_path, lang))


def code_parse_node(state: dict) -> dict:
    """LangGraph node: read state['files'] (list[FileEntry]) → produce
    state['chunks'] (list[CodeChunk])."""
    files = state["files"]
    all_chunks: list[CodeChunk] = []
    for fe in files:
        try:
            all_chunks.extend(parse_file(fe))
        except Exception as exc:
            logger.warning(f"[code_parse] failed on {fe.rel_path}: {exc}")
    logger.info(f"[code_parse] {len(files)} files → {len(all_chunks)} chunks")
    return {"chunks": all_chunks}

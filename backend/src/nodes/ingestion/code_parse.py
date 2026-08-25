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


TS_LANG_KEY = {
    "python": "python", "javascript": "javascript",
    "typescript": "typescript", "tsx": "tsx",
    "go": "go", "java": "java", "rust": "rust",
}


FALLBACK_LINES = 80
FALLBACK_OVERLAP = 10

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


def _fallback_chunks(text: str, rel_path: str, language: str) -> Iterator[CodeChunk]:
    lines = text.splitlines()
    n = len(lines)
    if n == 0:
        return
    step = max(1, FALLBACK_LINES - FALLBACK_OVERLAP)
    for start in range(0, n, step):
        end = min(n, start + FALLBACK_LINES)
        yield CodeChunk(
            content="\n".join(lines[start:end]),
            rel_path=rel_path, language=language,
            symbol_name=None, symbol_kind=None,
            start_line=start + 1, end_line=end,
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


def _ast_chunks(text: str, rel_path: str, language: str) -> Iterator[CodeChunk]:
    parser = _get_parser(language)
    if parser is None:
        yield from _fallback_chunks(text, rel_path, language)
        return

    symbol_types = SYMBOL_NODE_TYPES.get(language, set())
    if not symbol_types:
        yield from _fallback_chunks(text, rel_path, language)
        return

    source = text.encode("utf-8")
    tree = parser.parse(source)

    emitted_any = False
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type in symbol_types:
            content = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
            if content.strip():
                yield CodeChunk(
                    content=content,
                    rel_path=rel_path,
                    language=language,
                    symbol_name=_node_name(node, source),
                    symbol_kind=node.type,
                    start_line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                )
                emitted_any = True
            # Still descend for nested symbols (methods inside a class)
        for child in reversed(getattr(node, "children", []) or []):
            stack.append(child)

    if not emitted_any:
        # e.g. a file of only imports / constants — fall back to lines
        yield from _fallback_chunks(text, rel_path, language)


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
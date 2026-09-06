"""Per-request LangGraph trace collector.

Wraps a compiled graph's `.astream` so each node yields a small event
containing (node_name, input_keys, output_keys, output_preview, elapsed_ms).
Events are persisted to Redis keyed by trace_id and served back by the
graph visualizer UI.

Kept intentionally lightweight: no OTel, no LangSmith. Enough to render a
"which node is current, what went in, what came out" panel.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Iterable

from src.core.cache import get_redis_client
from src.core.logging import get_logger

logger = get_logger(__name__)

TRACE_TTL_SECONDS = 60 * 60  # 1h — traces are a debugging aid, not history

_MAX_PREVIEW_LEN = 1200
_MAX_LIST_PREVIEW = 3   # for list values, show a preview of up to N items


def new_trace_id() -> str:
    return uuid.uuid4().hex


def _trace_key(trace_id: str) -> str:
    return f"graph_trace:{trace_id}"


def _trace_owner_key(trace_id: str) -> str:
    # Owner id stored alongside the trace so read_trace can enforce
    # per-user isolation. Independent key so the events list keeps its
    # simple rpush/lrange shape.
    return f"graph_trace_owner:{trace_id}"


def set_trace_owner(trace_id: str, user_id: str) -> None:
    """Bind a trace_id to the user that started it. Best-effort — a
    Redis outage falls back to unowned (read_trace_for_user then treats
    it as inaccessible)."""
    try:
        r = get_redis_client()
        r.set(_trace_owner_key(trace_id), str(user_id), ex=TRACE_TTL_SECONDS)
    except Exception as exc:
        logger.warning(f"[graph_trace] failed to record owner: {exc}")


def _trace_owner(trace_id: str) -> str | None:
    try:
        return get_redis_client().get(_trace_owner_key(trace_id))
    except Exception as exc:
        logger.warning(f"[graph_trace] failed to read owner: {exc}")
        return None


def _item_preview(item: Any) -> str:
    """Render one item inside a list — chunks, dicts, or primitives — as a
    short, human-readable line."""
    try:
        if hasattr(item, "content"):
            meta = getattr(item, "metadata", {}) or {}
            score = getattr(item, "score", None)
            label_bits: list[str] = []
            src = meta.get("source") or meta.get("path")
            if src:
                label_bits.append(str(src))
            page = meta.get("page_number") or meta.get("page")
            if page:
                label_bits.append(f"p{page}")
            sl, el = meta.get("start_line"), meta.get("end_line")
            if sl and el:
                label_bits.append(f"L{sl}-{el}")
            sym = meta.get("symbol_name")
            if sym:
                label_bits.append(str(sym))
            if score is not None:
                label_bits.append(f"score={float(score):.3f}")
            head = " · ".join(label_bits) if label_bits else "chunk"
            body = (getattr(item, "content", "") or "")[:400]
            return f"[{head}]\n{body}"
        if isinstance(item, dict):
            return json.dumps(item, default=str)[:400]
        if isinstance(item, str):
            return item[:400]
        return repr(item)[:400]
    except Exception:
        return "<unrepresentable>"


def _preview(value: Any) -> str:
    """Compact human-readable preview of an arbitrary node output value."""
    try:
        if value is None:
            return "null"
        if isinstance(value, str):
            return value[:_MAX_PREVIEW_LEN]
        if isinstance(value, (int, float, bool)):
            return str(value)
        if isinstance(value, list):
            n = len(value)
            if n == 0:
                return "[empty list]"
            sample = value[:_MAX_LIST_PREVIEW]
            lines = [f"list · len={n}"]
            for i, itm in enumerate(sample):
                lines.append(f"  #{i + 1} {_item_preview(itm)}")
            if n > len(sample):
                lines.append(f"  … +{n - len(sample)} more")
            return "\n".join(lines)[:_MAX_PREVIEW_LEN]
        if isinstance(value, dict):
            return json.dumps(
                {k: _preview(v) for k, v in list(value.items())[:8]},
                default=str,
                indent=2,
            )[:_MAX_PREVIEW_LEN]
        return repr(value)[:_MAX_PREVIEW_LEN]
    except Exception:
        return "<unrepresentable>"


def _record(trace_id: str, event: dict) -> None:
    try:
        r = get_redis_client()
        r.rpush(_trace_key(trace_id), json.dumps(event, default=str))
        r.expire(_trace_key(trace_id), TRACE_TTL_SECONDS)
    except Exception as exc:
        logger.warning(f"[graph_trace] failed to record event: {exc}")


async def astream_with_trace(
    compiled_graph, initial_state: dict, trace_id: str
) -> dict:
    """Run a LangGraph compiled graph via .astream(), capturing each node
    step's output shape into Redis. Returns the accumulated final state
    exactly like .ainvoke() would."""
    _record(trace_id, {
        "type": "start",
        "ts": time.time(),
        "input_keys": sorted(initial_state.keys()),
    })
    # Both mirror what LangGraph's own .ainvoke() would surface at the end —
    # start from the initial state so consumers get the full picture.
    final: dict = dict(initial_state)
    accumulated: dict = dict(initial_state)
    step_ix = 0
    async for step in compiled_graph.astream(initial_state):
        for node_name, node_output in step.items():
            step_ix += 1
            output_keys = sorted((node_output or {}).keys()) if isinstance(node_output, dict) else []
            _record(trace_id, {
                "type": "node",
                "step": step_ix,
                "node": node_name,
                "ts": time.time(),
                "input_snapshot_keys": sorted(accumulated.keys()),
                "output_keys": output_keys,
                "output_preview": {k: _preview(v) for k, v in (node_output or {}).items()},
            })
            if isinstance(node_output, dict):
                accumulated.update(node_output)
                final.update(node_output)
    _record(trace_id, {"type": "end", "ts": time.time()})
    return final


def read_trace(trace_id: str) -> list[dict]:
    try:
        raw: Iterable[str] = get_redis_client().lrange(_trace_key(trace_id), 0, -1) or []
    except Exception as exc:
        logger.warning(f"[graph_trace] failed to read: {exc}")
        return []
    events: list[dict] = []
    for item in raw:
        try:
            events.append(json.loads(item))
        except Exception:
            continue
    return events


def read_trace_for_user(trace_id: str, user_id: str) -> list[dict] | None:
    """Owner-scoped read. Returns None when the trace isn't ours (or the
    owner mapping expired/is missing), so the caller can 404 instead of
    leaking another user's pipeline internals."""
    owner = _trace_owner(trace_id)
    if owner is None or owner != str(user_id):
        return None
    return read_trace(trace_id)


def graph_structure(compiled_graph) -> dict:
    """Return {nodes: [...], edges: [{source, target}]} extracted from a
    LangGraph compiled graph. Used by the UI to draw the diagram."""
    try:
        g = compiled_graph.get_graph()
    except Exception as exc:
        logger.warning(f"[graph_trace] get_graph failed: {exc}")
        return {"nodes": [], "edges": []}

    nodes: list[dict] = []
    seen_nodes: set[str] = set()
    for node in getattr(g, "nodes", {}).values() if hasattr(g, "nodes") else []:
        nid = getattr(node, "id", None) or str(node)
        if nid in seen_nodes:
            continue
        seen_nodes.add(nid)
        nodes.append({"id": nid})

    edges: list[dict] = []
    for edge in getattr(g, "edges", []) or []:
        src = getattr(edge, "source", None)
        tgt = getattr(edge, "target", None)
        cond = getattr(edge, "conditional", False)
        if src and tgt:
            edges.append({"source": src, "target": tgt, "conditional": bool(cond)})
    return {"nodes": nodes, "edges": edges}

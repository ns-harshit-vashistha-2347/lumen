from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.cache import get_cached_query, set_cached_query
from src.core.chat_history import append_turn, ensure_session, load_history
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.graph_trace import astream_with_trace, new_trace_id
from src.core.llm import get_llm
from src.core.logging import get_logger
from src.core.rate_limit import limiter
from src.graphs.query_graph import query_graph, retrieval_graph
from src.models.chat import ChatKind
from src.models.user import User
from src.nodes.retrieval.generation import (
    SYSTEM_PROMPT, _build_context, _history_messages, _pick_chunks,
)
from src.schemas.document import QueryRequest, QueryResponse, SourceChunk

query_router = APIRouter(prefix="/query", tags=["query"])
logger = get_logger(__name__)


@query_router.post("", response_model=QueryResponse)
@limiter.limit("30/minute")
async def run_query(
    request: Request,
    payload: QueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info(
        f"[/query] user_id={current_user.id} query='{payload.query[:60]}' "
        f"top_k={payload.top_k} session_id={payload.session_id}"
    )

    session = None
    history: list[dict] = []
    if payload.session_id is not None or payload.persist:
        session = await ensure_session(
            db, user_id=current_user.id, kind=ChatKind.DOC,
            session_id=payload.session_id, seed_title=payload.query,
        )
        history = await load_history(db, session.id)

    # Cache is per-user; only safe to reuse when there is NO history since the
    # answer is conditioned on the conversation.
    scope_ids = [str(d) for d in payload.document_ids] if payload.document_ids else None
    if not history:
        cached = get_cached_query(
            payload.query, payload.top_k, str(current_user.id), scope_ids
        )
        if cached is not None:
            logger.info(f"[/query] cache hit user_id={current_user.id}")
            if session is not None:
                await append_turn(
                    db, session,
                    user_content=payload.query,
                    assistant_content=cached.get("answer", ""),
                    payload={"sources": cached.get("sources", []), "cached": True},
                    trace_id=None,
                )
            return QueryResponse(session_id=session.id if session else None, **cached)

    trace_id = new_trace_id()
    initial_state = {
        "query": payload.query,
        "top_k": payload.top_k,
        "user_id": str(current_user.id),
        "document_ids": scope_ids,
        "chat_history": history,
    }
    try:
        result = await astream_with_trace(query_graph, initial_state, trace_id)
    except Exception as exc:
        logger.exception(f"[/query] graph execution failed user_id={current_user.id}: {exc}")
        raise HTTPException(status_code=500, detail="Query pipeline failed") from exc

    source_chunks = (
        result.get("compressed_results")
        or result.get("reranked_results")
        or result.get("fused_results", [])
    )
    sources = [
        SourceChunk(
            content=c.metadata.get("original_content") or c.metadata.get("raw_content", c.content),
            metadata=c.metadata,
            score=c.score,
        )
        for c in source_chunks
    ]
    answer = result.get("answer", "")

    response_payload = {"answer": answer, "sources": sources}

    if session is not None:
        await append_turn(
            db, session,
            user_content=payload.query,
            assistant_content=answer,
            payload={"sources": [s.model_dump(mode="json") for s in sources]},
            trace_id=trace_id,
        )

    if not history:
        set_cached_query(
            payload.query, payload.top_k, str(current_user.id),
            QueryResponse(**response_payload).model_dump(mode="json"),
            document_ids=scope_ids,
        )

    return QueryResponse(
        session_id=session.id if session else None,
        trace_id=trace_id,
        **response_payload,
    )


@query_router.post("/stream")
@limiter.limit("30/minute")
async def run_query_stream(
    request: Request,
    payload: QueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = None
    history: list[dict] = []
    if payload.session_id is not None or payload.persist:
        session = await ensure_session(
            db, user_id=current_user.id, kind=ChatKind.DOC,
            session_id=payload.session_id, seed_title=payload.query,
        )
        history = await load_history(db, session.id)

    trace_id = new_trace_id()
    try:
        partial = await astream_with_trace(retrieval_graph, {
            "query": payload.query,
            "top_k": payload.top_k,
            "user_id": str(current_user.id),
            "document_ids": [str(d) for d in payload.document_ids] if payload.document_ids else None,
            "chat_history": history,
        }, trace_id)
    except Exception as exc:
        logger.exception(f"[/query/stream] retrieval failed user_id={current_user.id}: {exc}")
        raise HTTPException(status_code=500, detail="Retrieval pipeline failed") from exc
    chunks = _pick_chunks(partial)
    context = _build_context(chunks)
    complexity = partial.get("complexity", "complex")
    task_name = "generate_simple" if complexity == "simple" else "generate_complex"
    llm = get_llm(task=task_name, temperature=0.2)

    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    messages.extend(_history_messages(history))
    messages.append(HumanMessage(content=f"Context:\n\n{context}\n\nQuestion: {payload.query}"))

    async def token_stream():
        import json
        # Full sources in the meta header so the client can render the same
        # cited-passage UI that the non-streaming endpoint returns — the
        # bytes are already loaded and would need to be resent otherwise.
        header = {
            "type": "meta",
            "session_id": str(session.id) if session else None,
            "trace_id": trace_id,
            "sources": [
                {
                    "content": (
                        c.metadata.get("original_content")
                        or c.metadata.get("raw_content", c.content)
                    ),
                    "metadata": c.metadata,
                    "score": c.score,
                    # keep the light preview fields so the streaming skeleton
                    # can still render before the answer lands.
                    "source": c.metadata.get("source"),
                    "page": c.metadata.get("page_number") or c.metadata.get("page"),
                    "path": c.metadata.get("path"),
                    "start_line": c.metadata.get("start_line"),
                    "end_line": c.metadata.get("end_line"),
                    "symbol_name": c.metadata.get("symbol_name"),
                }
                for c in chunks
            ],
        }
        yield json.dumps(header) + "\n"
        collected: list[str] = []
        try:
            async for chunk in llm.astream(messages):
                if chunk.content:
                    collected.append(chunk.content)
                    yield chunk.content
        except Exception as exc:
            logger.exception(f"[/query/stream] llm stream failed: {exc}")
            yield "\n[error: generation interrupted]"
        if session is not None and collected:
            try:
                await append_turn(
                    db, session,
                    user_content=payload.query,
                    assistant_content="".join(collected),
                    payload={"streamed": True},
                    trace_id=trace_id,
                )
            except Exception as exc:
                logger.exception(f"[/query/stream] failed to persist turn: {exc}")

    return StreamingResponse(token_stream(), media_type="text/plain")

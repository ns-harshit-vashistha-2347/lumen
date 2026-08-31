from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.chat_history import append_turn, ensure_session, load_history
from src.core.config import settings
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.graph_trace import astream_with_trace, new_trace_id
from src.core.llm import get_llm
from src.core.logging import get_logger
from src.graphs.code_query_graph import code_query_graph, code_retrieval_graph
from src.models.chat import ChatKind
from src.models.repo import Repo, RepoStatus
from src.models.user import User
from src.nodes.retrieval.generation import (
    SYSTEM_PROMPT, _build_context, _history_messages,
)
from src.nodes.retrieval.graph_query import (
    calls_ego, calls_subgraph, callers_of, callees_of, find_symbols,
    graph_stats, importers_of, imports_ego, imports_from, imports_subgraph,
    list_files, list_symbols,
)
from src.schemas.code_query import (
    CodeQueryRequest, CodeQueryResponse, CodeSourceChunk, GraphHit,
)

code_query_router = APIRouter(prefix="/code-query", tags=["code-query"])
logger = get_logger(__name__)


async def _load_repo(db: AsyncSession, user: User, repo_id: uuid.UUID) -> Repo:
    result = await db.execute(
        select(Repo).where(Repo.id == repo_id, Repo.user_id == user.id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    if repo.status != RepoStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail=f"Repo ingestion is {repo.status.value}; wait for completion",
        )
    return repo


@code_query_router.post("", response_model=CodeQueryResponse)
async def run_code_query(
    payload: CodeQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = await _load_repo(db, current_user, payload.repo_id)
    top_k = payload.top_k or settings.CODE_QUERY_TOP_K

    session = None
    history: list[dict] = []
    if payload.session_id is not None or payload.persist:
        session = await ensure_session(
            db, user_id=current_user.id, kind=ChatKind.CODE,
            session_id=payload.session_id, repo_id=repo.id,
            seed_title=payload.query,
        )
        if session.repo_id != repo.id:
            raise HTTPException(
                status_code=400,
                detail="session_id belongs to a different repo",
            )
        history = await load_history(db, session.id)

    trace_id = new_trace_id()
    result = await astream_with_trace(code_query_graph, {
        "repo_id": str(repo.id),
        "query": payload.query,
        "top_k": top_k,
        "chat_history": history,
    }, trace_id)

    chunks = result.get("dense_results") or []
    sources = [
        CodeSourceChunk(
            path=c.metadata.get("path", "unknown"),
            symbol_name=c.metadata.get("symbol_name") or None,
            symbol_kind=c.metadata.get("symbol_kind") or None,
            start_line=c.metadata.get("start_line"),
            end_line=c.metadata.get("end_line"),
            content=c.content,
            score=c.score,
        )
        for c in chunks
    ]
    graph_hits = [GraphHit(**h) for h in result.get("graph_hits", [])]
    answer = result.get("answer", "")
    intent = result.get("code_intent", "general")

    if session is not None:
        await append_turn(
            db, session,
            user_content=payload.query,
            assistant_content=answer,
            payload={
                "intent": intent,
                "sources": [s.model_dump(mode="json") for s in sources],
                "graph_hits": [g.model_dump(mode="json") for g in graph_hits],
            },
            trace_id=trace_id,
        )

    return CodeQueryResponse(
        answer=answer,
        intent=intent,
        graph_hits=graph_hits,
        sources=sources,
        session_id=session.id if session else None,
        trace_id=trace_id,
    )


# --- direct graph endpoints (no LLM) ---------------------------------------

@code_query_router.get("/{repo_id}/symbols")
async def lookup_symbol(
    repo_id: uuid.UUID,
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    hits = find_symbols(str(repo_id), name)
    return [h.__dict__ for h in hits]


@code_query_router.get("/{repo_id}/callers")
async def lookup_callers(
    repo_id: uuid.UUID,
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    return [h.__dict__ for h in callers_of(str(repo_id), name)]


@code_query_router.get("/{repo_id}/callees")
async def lookup_callees(
    repo_id: uuid.UUID,
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    return [h.__dict__ for h in callees_of(str(repo_id), name)]


@code_query_router.get("/{repo_id}/imports")
async def lookup_imports(
    repo_id: uuid.UUID,
    file: str,
    direction: str = "from",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    if direction == "to":
        return {"importers": importers_of(str(repo_id), file)}
    return imports_from(str(repo_id), file)


@code_query_router.get("/{repo_id}/graph/stats")
async def graph_kb_stats(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    return graph_stats(str(repo_id))


@code_query_router.get("/{repo_id}/graph/files")
async def graph_kb_files(
    repo_id: uuid.UUID,
    q: str = "",
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    return list_files(str(repo_id), query=q, limit=limit, offset=offset)


@code_query_router.get("/{repo_id}/graph/symbols")
async def graph_kb_symbols(
    repo_id: uuid.UUID,
    q: str = "",
    file: str = "",
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    return list_symbols(str(repo_id), query=q, file=file, limit=limit, offset=offset)


@code_query_router.get("/{repo_id}/graph/subgraph")
async def graph_kb_subgraph(
    repo_id: uuid.UUID,
    kind: str = "calls",
    limit: int = 120,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    if kind == "imports":
        return imports_subgraph(str(repo_id), limit=limit)
    return calls_subgraph(str(repo_id), limit=limit)


@code_query_router.get("/{repo_id}/graph/ego")
async def graph_kb_ego(
    repo_id: uuid.UUID,
    kind: str = "calls",
    id: str = "",
    direction: str = "out",
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    if not id:
        raise HTTPException(status_code=400, detail="id required")
    if kind == "imports":
        return imports_ego(str(repo_id), id, direction=direction, limit=limit)
    return calls_ego(str(repo_id), id, direction=direction, limit=limit)


@code_query_router.post("/stream")
async def stream_code_query(
    payload: CodeQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = await _load_repo(db, current_user, payload.repo_id)
    top_k = payload.top_k or settings.CODE_QUERY_TOP_K

    session = None
    history: list[dict] = []
    if payload.session_id is not None or payload.persist:
        session = await ensure_session(
            db, user_id=current_user.id, kind=ChatKind.CODE,
            session_id=payload.session_id, repo_id=repo.id,
            seed_title=payload.query,
        )
        if session.repo_id != repo.id:
            raise HTTPException(
                status_code=400,
                detail="session_id belongs to a different repo",
            )
        history = await load_history(db, session.id)

    trace_id = new_trace_id()
    try:
        partial = await astream_with_trace(code_retrieval_graph, {
            "repo_id": str(repo.id),
            "query": payload.query,
            "top_k": top_k,
            "chat_history": history,
        }, trace_id)
    except Exception as exc:
        logger.exception(f"[/code-query/stream] retrieval failed user_id={current_user.id}: {exc}")
        raise HTTPException(status_code=500, detail="Retrieval pipeline failed") from exc

    chunks = partial.get("dense_results") or []
    context = _build_context(chunks)
    intent = partial.get("code_intent", "general")
    graph_hits = partial.get("graph_hits", [])

    llm = get_llm(task="generate_complex", temperature=0.2)
    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    messages.extend(_history_messages(history))
    messages.append(HumanMessage(content=f"Context:\n\n{context}\n\nQuestion: {payload.query}"))

    async def token_stream():
        header = {
            "type": "meta",
            "intent": intent,
            "graph_hits": graph_hits,
            "session_id": str(session.id) if session else None,
            "trace_id": trace_id,
            "sources": [
                {"path": c.metadata.get("path"),
                 "start_line": c.metadata.get("start_line"),
                 "end_line": c.metadata.get("end_line"),
                 "symbol_name": c.metadata.get("symbol_name"),
                 "symbol_kind": c.metadata.get("symbol_kind"),
                 "score": float(c.metadata.get("score", 0.0)),
                 "content": c.page_content}
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
            logger.exception(f"[/code-query/stream] llm stream failed: {exc}")
            yield "\n[error: generation interrupted]"
        if session is not None and collected:
            try:
                await append_turn(
                    db, session,
                    user_content=payload.query,
                    assistant_content="".join(collected),
                    payload={
                        "streamed": True,
                        "intent": intent,
                        "graph_hits": graph_hits,
                        "sources": header["sources"],
                    },
                    trace_id=trace_id,
                )
            except Exception as exc:
                logger.exception(f"[/code-query/stream] failed to persist turn: {exc}")

    return StreamingResponse(token_stream(), media_type="text/plain")

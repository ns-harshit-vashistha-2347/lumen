from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.graphs.code_query_graph import code_query_graph
from src.models.repo import Repo, RepoStatus
from src.models.user import User
from src.nodes.retrieval.graph_query import (
    callers_of, callees_of, find_symbols, importers_of, imports_from,
)
from src.schemas.code_query import (
    CodeQueryRequest, CodeQueryResponse, CodeSourceChunk, GraphHit,
)


from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage

from src.core.llm import get_llm
from src.graphs.code_query_graph import code_retrieval_graph
from src.nodes.retrieval.generation import SYSTEM_PROMPT, _build_context


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

    result = await code_query_graph.ainvoke({
        "repo_id": str(repo.id),
        "query": payload.query,
        "top_k": top_k,
    })

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

    return CodeQueryResponse(
        answer=result.get("answer", ""),
        intent=result.get("code_intent", "general"),
        graph_hits=graph_hits,
        sources=sources,
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
    direction: str = "from",       # "from" (file->targets) or "to" (importers of file)
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_repo(db, current_user, repo_id)
    if direction == "to":
        return {"importers": importers_of(str(repo_id), file)}
    return imports_from(str(repo_id), file)


@code_query_router.post("/stream")
async def stream_code_query(
    payload: CodeQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = await _load_repo(db, current_user, payload.repo_id)
    top_k = payload.top_k or settings.CODE_QUERY_TOP_K

    partial = await code_retrieval_graph.ainvoke({
        "repo_id": str(repo.id),
        "query": payload.query,
        "top_k": top_k,
    })

    chunks = partial.get("dense_results") or []
    context = _build_context(chunks)
    intent = partial.get("code_intent", "general")

    # Send intent + source hint first as a metadata frame, then stream tokens.
    graph_hits = partial.get("graph_hits", [])

    llm = get_llm(task="generate_complex", temperature=0.2)

    async def token_stream():
        import json
        header = {
            "type": "meta",
            "intent": intent,
            "graph_hits": graph_hits,
            "sources": [
                {"path": c.metadata.get("path"),
                 "start_line": c.metadata.get("start_line"),
                 "end_line": c.metadata.get("end_line"),
                 "symbol_name": c.metadata.get("symbol_name")}
                for c in chunks
            ],
        }
        yield json.dumps(header) + "\n"
        async for chunk in llm.astream([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"Context:\n\n{context}\n\nQuestion: {payload.query}"),
        ]):
            if chunk.content:
                yield chunk.content

    return StreamingResponse(token_stream(), media_type="text/plain")
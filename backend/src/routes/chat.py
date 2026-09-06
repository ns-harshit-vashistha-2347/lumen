from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.graph_trace import graph_structure, read_trace_for_user
from src.core.logging import get_logger
from src.graphs.code_query_graph import code_query_graph
from src.graphs.code_ingestion_graph import code_ingestion_graph
from src.graphs.query_graph import query_graph
from src.models.chat import ChatKind, ChatMessage, ChatSession
from src.models.repo import Repo
from src.models.user import User
from src.schemas.chat import (
    ChatMessageResponse, ChatSessionCreate, ChatSessionResponse,
    ChatSessionUpdate, GraphStructureResponse, GraphTraceResponse,
)

chat_router = APIRouter(prefix="/chat", tags=["chat"])
logger = get_logger(__name__)


async def _load_session(db: AsyncSession, user: User, session_id: uuid.UUID) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


@chat_router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(
    payload: ChatSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.kind == ChatKind.CODE:
        if not payload.repo_id:
            raise HTTPException(status_code=400, detail="repo_id required for code chat")
        result = await db.execute(
            select(Repo).where(Repo.id == payload.repo_id, Repo.user_id == current_user.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Repo not found")

    session = ChatSession(
        user_id=current_user.id,
        kind=payload.kind,
        repo_id=payload.repo_id if payload.kind == ChatKind.CODE else None,
        title=payload.title or "new chat",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@chat_router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(
    kind: ChatKind | None = None,
    repo_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(ChatSession).where(ChatSession.user_id == current_user.id)
    if kind is not None:
        stmt = stmt.where(ChatSession.kind == kind)
    if repo_id is not None:
        stmt = stmt.where(ChatSession.repo_id == repo_id)
    stmt = stmt.order_by(ChatSession.updated_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@chat_router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _load_session(db, current_user, session_id)


@chat_router.patch("/sessions/{session_id}", response_model=ChatSessionResponse)
async def rename_session(
    session_id: uuid.UUID,
    payload: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _load_session(db, current_user, session_id)
    new_title = (payload.title or "").strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    session.title = new_title[:255]
    await db.commit()
    await db.refresh(session)
    return session


@chat_router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _load_session(db, current_user, session_id)
    await db.delete(session)
    await db.commit()
    return None


@chat_router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def list_messages(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _load_session(db, current_user, session_id)
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


# --- graph visualizer -------------------------------------------------------

_GRAPHS = {
    "query": query_graph,
    "code_query": code_query_graph,
    "code_ingestion": code_ingestion_graph,
}


@chat_router.get("/graphs/{name}", response_model=GraphStructureResponse)
async def get_graph_structure(
    name: str,
    _current_user: User = Depends(get_current_user),
):
    if name not in _GRAPHS:
        raise HTTPException(status_code=404, detail=f"Unknown graph '{name}'")
    struct = graph_structure(_GRAPHS[name])
    return GraphStructureResponse(name=name, **struct)


@chat_router.get("/traces/{trace_id}", response_model=GraphTraceResponse)
async def get_graph_trace(
    trace_id: str,
    current_user: User = Depends(get_current_user),
):
    events = read_trace_for_user(trace_id, str(current_user.id))
    if events is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return GraphTraceResponse(trace_id=trace_id, events=events)

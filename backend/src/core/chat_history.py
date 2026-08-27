"""Helpers to load prior turns from a chat session and persist new ones.

Kept out of the route files so both /query and /code-query share the exact
same behavior for session bookkeeping.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.chat import ChatKind, ChatMessage, ChatRole, ChatSession


async def ensure_session(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: ChatKind,
    session_id: uuid.UUID | None,
    repo_id: uuid.UUID | None = None,
    seed_title: str | None = None,
) -> ChatSession:
    """Return the requested session (verifying ownership) or auto-create one.

    Autocreation makes the client optional — old callers that don't pass a
    session_id still work; they just don't get history persisted the way a
    session-aware client does.
    """
    if session_id is not None:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Chat session not found")
        return session

    # Fold whitespace, cap length, and fall back to "new chat" if the seed is
    # empty or whitespace-only so the session list never renders a blank row.
    raw_title = (seed_title or "").strip()
    title = (raw_title[:80] or "new chat")
    session = ChatSession(
        user_id=user_id,
        kind=kind,
        repo_id=repo_id if kind == ChatKind.CODE else None,
        title=title,
    )
    db.add(session)
    await db.flush()
    return session


async def load_history(
    db: AsyncSession, session_id: uuid.UUID, limit_turns: int = 6
) -> list[dict]:
    """Return the last `limit_turns` (user+assistant pairs) as a plain
    list of {role, content} dicts, oldest-first."""
    per_page = limit_turns * 2
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(per_page)
    )
    rows = list(result.scalars().all())
    rows.reverse()
    return [{"role": m.role.value, "content": m.content} for m in rows]


async def append_turn(
    db: AsyncSession,
    session: ChatSession,
    *,
    user_content: str,
    assistant_content: str,
    payload: dict[str, Any] | None,
    trace_id: str | None,
) -> tuple[ChatMessage, ChatMessage]:
    user_msg = ChatMessage(
        session_id=session.id,
        role=ChatRole.USER,
        content=user_content,
    )
    asst_msg = ChatMessage(
        session_id=session.id,
        role=ChatRole.ASSISTANT,
        content=assistant_content,
        payload=payload,
        trace_id=trace_id,
    )
    db.add_all([user_msg, asst_msg])
    # Touch parent so `updated_at` reflects most recent activity — the
    # session list is sorted by it.
    session.updated_at = func.now()
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(asst_msg)
    return user_msg, asst_msg

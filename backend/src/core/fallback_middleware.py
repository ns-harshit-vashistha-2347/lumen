"""Middleware that surfaces LLM router health drift to the client.

We snapshot the sum of consecutive_failures across providers before and
after each request. If it grew, at least one provider tripped a cooldown
during this request — emit an X-LLM-Fallback header so the UI can show
a transient banner.
"""
from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from src.core.llm_router import get_router


def _failure_total() -> int:
    router = get_router()
    return sum(p.health.consecutive_failures for p in router._providers.values())


class LLMFallbackMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        before = _failure_total()
        response = await call_next(request)
        after = _failure_total()
        if after > before:
            snap = get_router().health_snapshot()
            tripped = [name for name, s in snap.items() if s["cool_down_remaining"] > 0]
            if tripped:
                response.headers["X-LLM-Fallback"] = ",".join(tripped)
        return response
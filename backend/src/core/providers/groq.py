from __future__ import annotations

from functools import lru_cache
from typing import Any

from langchain_groq import ChatGroq

from src.core.config import settings
from src.core.providers.base import LLMProvider, TaskTier


class GroqProvider(LLMProvider):
    name = "groq"

    def is_configured(self) -> bool:
        return bool(settings.GROQ_API_KEY)


    def _model_for_tier(self, tier: TaskTier, pipeline: str = "doc") -> str:
        if pipeline == "code":
            code = {
                "small": settings.GROQ_MODEL_CODE_SMALL,
                "medium": settings.GROQ_MODEL_CODE_MEDIUM,
                "large": settings.GROQ_MODEL_CODE_LARGE,
            }[tier]
            if code:
                return code
        return {
            "small": settings.GROQ_MODEL_SMALL,
            "medium": settings.GROQ_MODEL_MEDIUM,
            "large": settings.GROQ_MODEL_LARGE,
        }[tier]


    def build_chat_model(self, tier: TaskTier, temperature: float, pipeline: str = "doc") -> Any:
        return _cached_groq(self._model_for_tier(tier, pipeline), temperature)


    def is_rate_limit_error(self, exc: BaseException) -> tuple[bool, float | None]:
        cls = type(exc).__name__.lower()
        msg = str(exc).lower()
        if "ratelimit" in cls or "rate_limit" in msg or "429" in msg or "too many requests" in msg:
            retry_after = _extract_retry_after(exc)
            return True, retry_after
        return False, None


@lru_cache
def _cached_groq(model: str, temperature: float) -> ChatGroq:
    return ChatGroq(
        api_key=settings.GROQ_API_KEY,
        model=model,
        temperature=temperature,
        max_retries=0,
        timeout=30,
    )


def _extract_retry_after(exc: BaseException) -> float | None:
    # Best-effort: many client libs expose .response.headers or .retry_after
    resp = getattr(exc, "response", None)
    if resp is not None:
        headers = getattr(resp, "headers", {}) or {}
        val = headers.get("retry-after") or headers.get("Retry-After")
        if val:
            try:
                return float(val)
            except ValueError:
                pass
    return None
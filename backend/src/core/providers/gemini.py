from __future__ import annotations

from functools import lru_cache
from typing import Any

from src.core.config import settings
from src.core.providers.base import LLMProvider, TaskTier


class GeminiProvider(LLMProvider):
    name = "gemini"

    def is_configured(self) -> bool:
        return bool(settings.GEMINI_API_KEY)

    def _model_for_tier(self, tier: TaskTier) -> str:
        return {
            "small": settings.GEMINI_MODEL_SMALL,
            "medium": settings.GEMINI_MODEL_MEDIUM,
            "large": settings.GEMINI_MODEL_LARGE,
        }[tier]

    def build_chat_model(self, tier: TaskTier, temperature: float) -> Any:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return _cached_gemini(self._model_for_tier(tier), temperature)

    def is_rate_limit_error(self, exc: BaseException) -> tuple[bool, float | None]:
        cls = type(exc).__name__.lower()
        msg = str(exc).lower()
        if (
            "resourceexhausted" in cls
            or "quotaexceeded" in cls
            or "ratelimit" in cls
            or "429" in msg
            or "quota" in msg
            or "rate limit" in msg
        ):
            return True, _extract_retry_after(exc)
        return False, None


@lru_cache
def _cached_gemini(model: str, temperature: float):
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(
        model=model,
        temperature=temperature,
        google_api_key=settings.GEMINI_API_KEY,
    )


def _extract_retry_after(exc: BaseException) -> float | None:
    retry = getattr(exc, "retry", None)
    if retry is not None:
        delay = getattr(retry, "_deadline", None) or getattr(retry, "deadline", None)
        if isinstance(delay, (int, float)):
            return float(delay)
    return None
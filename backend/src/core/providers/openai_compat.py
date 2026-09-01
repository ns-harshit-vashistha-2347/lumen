"""Base class for any OpenAI-compatible provider (OpenRouter, Cerebras,
Together, Fireworks, Groq's raw OpenAI endpoint, local vLLM, ...).

Concrete providers only need to declare: name, is_configured(),
_model_for_tier(), and (optionally) rate-limit heuristics."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from src.core.providers.base import LLMProvider, TaskTier


class OpenAICompatProvider(LLMProvider):
    """Any provider that speaks the OpenAI Chat Completions API."""

    base_url: str = ""
    api_key: str = ""

    def build_chat_model(self, tier: TaskTier, temperature: float, pipeline: str = "doc") -> Any:
        return _cached_openai(
            self.name, self._model_for_tier(tier, pipeline), temperature, self.base_url, self.api_key,
        )

    def _model_for_tier(self, tier: TaskTier, pipeline: str = "doc") -> str:
        raise NotImplementedError

    def is_rate_limit_error(self, exc: BaseException) -> tuple[bool, float | None]:
        cls = type(exc).__name__.lower()
        msg = str(exc).lower()
        if (
            "ratelimit" in cls
            or "rate_limit" in msg
            or "429" in msg
            or "too many requests" in msg
            or "quota" in msg
        ):
            return True, _retry_after(exc)
        # Generic transient / model-gone signals — worth failing over.
        if (
            "notfound" in cls
            or "unavailable" in cls
            or "404" in msg
            or "503" in msg
            or "502" in msg
            or "500" in msg
        ):
            return True, None
        return False, None


@lru_cache
def _cached_openai(name: str, model: str, temperature: float, base_url: str, api_key: str):
    # Imported lazily so envs that don't use these providers don't pay the cost.
    from langchain_openai import ChatOpenAI
    # max_retries=0: don't retry inside the client — the router fails over to
    # the next provider on rate-limit / 4xx / 5xx, and internal retries just
    # delay that. request_timeout keeps a stuck provider from stalling stream.
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=api_key,
        base_url=base_url,
        max_retries=0,
        timeout=30,
    )


def _retry_after(exc: BaseException) -> float | None:
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

from __future__ import annotations

from typing import Any, Iterable

from src.core.config import settings
from src.core.logging import get_logger
from src.core.providers import GeminiProvider, GroqProvider, LLMProvider
from src.core.providers.base import TASK_TO_TIER, RateLimitedError, TaskTier

logger = get_logger(__name__)



DEFAULT_POLICY: dict[TaskTier, list[str]] = {
    "small":  ["gemini", "groq"],
    "medium": ["gemini", "groq"],
    "large":  ["gemini", "groq"],
}

DEFAULT_COOLDOWN_SECONDS = 60.0


class RoutedChatModel:
    """Duck-typed LangChain chat model.

    Exposes exactly the methods the existing nodes use:
      - .invoke(messages)   -> AIMessage-like object with .content
      - .ainvoke(messages)  -> AIMessage-like object with .content
      - .astream(messages)  -> async iterator of chunks with .content

    On a RateLimitedError from the preferred provider, trips its cool-down
    and retries against the next provider in the policy list. If every
    provider is cool, re-raises the last error.
    """

    def __init__(self, router: "LLMRouter", tier: TaskTier, temperature: float, task: str):
        self._router = router
        self._tier = tier
        self._temperature = temperature
        self._task = task

    def _providers(self) -> list[LLMProvider]:
        return self._router.providers_for(self._tier)


    def invoke(self, messages, **kwargs) -> Any:
        last_exc: BaseException | None = None
        for provider in self._providers():
            model = provider.build_chat_model(self._tier, self._temperature)
            try:
                logger.debug(f"[llm_router] task={self._task} tier={self._tier} → {provider.name}")
                result = model.invoke(messages, **kwargs)
                provider.health.clear()
                return result
            except BaseException as exc:
                is_rl, retry_after = provider.is_rate_limit_error(exc)
                if is_rl:
                    seconds = retry_after or DEFAULT_COOLDOWN_SECONDS
                    logger.warning(
                        f"[llm_router] {provider.name} rate-limited for task={self._task}; "
                        f"cooling down {seconds:.0f}s and failing over"
                    )
                    provider.health.trip(seconds, reason=str(exc)[:200])
                    last_exc = RateLimitedError(provider.name, retry_after, exc)
                    continue
                raise
        assert last_exc is not None
        raise last_exc


    async def ainvoke(self, messages, **kwargs) -> Any:
        last_exc: BaseException | None = None
        for provider in self._providers():
            model = provider.build_chat_model(self._tier, self._temperature)
            try:
                logger.debug(f"[llm_router] (async) task={self._task} tier={self._tier} → {provider.name}")
                result = await model.ainvoke(messages, **kwargs)
                provider.health.clear()
                return result
            except BaseException as exc:
                is_rl, retry_after = provider.is_rate_limit_error(exc)
                if is_rl:
                    seconds = retry_after or DEFAULT_COOLDOWN_SECONDS
                    logger.warning(
                        f"[llm_router] {provider.name} rate-limited (async) for task={self._task}; "
                        f"cooling down {seconds:.0f}s and failing over"
                    )
                    provider.health.trip(seconds, reason=str(exc)[:200])
                    last_exc = RateLimitedError(provider.name, retry_after, exc)
                    continue
                raise
        assert last_exc is not None
        raise last_exc


    async def astream(self, messages, **kwargs):
        """Fail over BEFORE the first token; once streaming has started we
        can't safely restart on a different provider mid-answer."""
        last_exc: BaseException | None = None
        for provider in self._providers():
            model = provider.build_chat_model(self._tier, self._temperature)
            try:
                stream = model.astream(messages, **kwargs)
                first = await stream.__anext__()
            except StopAsyncIteration:
                provider.health.clear()
                return
            except BaseException as exc:
                is_rl, retry_after = provider.is_rate_limit_error(exc)
                if is_rl:
                    seconds = retry_after or DEFAULT_COOLDOWN_SECONDS
                    logger.warning(
                        f"[llm_router] {provider.name} rate-limited (stream) for task={self._task}; "
                        f"cooling down {seconds:.0f}s and failing over"
                    )
                    provider.health.trip(seconds, reason=str(exc)[:200])
                    last_exc = RateLimitedError(provider.name, retry_after, exc)
                    continue
                raise

            provider.health.clear()

            async def _gen() -> Iterable[Any]:
                yield first
                async for chunk in stream:
                    yield chunk

            async for chunk in _gen():
                yield chunk
            return
        assert last_exc is not None
        raise last_exc


class LLMRouter:
    """Owns the provider registry, per-provider health, and task→tier→
    provider-order policy. One instance per process."""

    def __init__(self, policy: dict[TaskTier, list[str]] | None = None):
        self._providers: dict[str, LLMProvider] = {
            "groq": GroqProvider(),
            "gemini": GeminiProvider(),
        }
        self._policy = policy or DEFAULT_POLICY

    def register(self, provider: LLMProvider) -> None:
        self._providers[provider.name] = provider

    def providers_for(self, tier: TaskTier) -> list[LLMProvider]:
        """Return providers in policy order, filtered to those that are
        configured AND currently healthy. If ALL are cooling down, return
        the full configured list anyway (better to try and fail than to
        refuse service)."""
        preferred = self._policy.get(tier, self._policy["medium"])
        configured = [
            self._providers[name] for name in preferred
            if name in self._providers and self._providers[name].is_configured()
        ]
        if not configured:
            raise RuntimeError(
                f"No LLM providers configured for tier '{tier}'. "
                f"Set GROQ_API_KEY and/or GEMINI_API_KEY."
            )
        healthy = [p for p in configured if p.health.is_available()]
        return healthy or configured

    def get_chat(self, task: str = "default", temperature: float = 0.2) -> RoutedChatModel:
        tier = TASK_TO_TIER.get(task, "medium")
        return RoutedChatModel(self, tier=tier, temperature=temperature, task=task)

    def health_snapshot(self) -> dict:
        """For a future /status/providers endpoint."""
        import time
        now = time.time()
        return {
            name: {
                "configured": p.is_configured(),
                "available": p.health.is_available(now),
                "cool_down_remaining": max(0.0, p.health.cool_down_until - now),
                "consecutive_failures": p.health.consecutive_failures,
                "last_error": p.health.last_error,
            }
            for name, p in self._providers.items()
        }


_router: LLMRouter | None = None


def get_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
    return _router
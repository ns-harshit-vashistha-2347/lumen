from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

class RateLimitedError(Exception):
    def __init__(self, provider: str, retry_after: float | None = None, original: Exception | None = None):
        self.provider = provider
        self.retry_after = retry_after
        self.original = original


TaskTier = str
Pipeline = str  # "doc" or "code"

TASK_TO_TIER: dict[str, TaskTier] = {
    "classify": "small",
    "rewrite": "small",
    "compress": "small",
    "verify": "small",
    "generate_simple": "medium",
    "generate_complex": "large",
    "default": "medium",
}

# Tasks that should ALWAYS run against the code pipeline regardless of
# the caller-supplied pipeline arg. Keeps callers from forgetting.
CODE_TASKS: frozenset[str] = frozenset({
    "code_classify",
    "code_generate",
    "code_generate_simple",
    "code_verify",
    "code_rewrite",
})

# Extend task→tier for code-only tasks.
TASK_TO_TIER.update({
    "code_classify": "small",
    "code_rewrite": "small",
    "code_verify": "small",
    "code_generate_simple": "medium",
    "code_generate": "large",
})

@dataclass
class ProviderHealth:
    cool_down_until: float = 0.0            # unix ts; 0 = healthy
    consecutive_failures: int = 0
    last_error: str = ""

    def is_available(self, now: float | None = None) -> bool:
        return (now or time.time()) >= self.cool_down_until

    def trip(self, seconds: float, reason: str = "") -> None:
        self.cool_down_until = time.time() + seconds
        self.consecutive_failures += 1
        self.last_error = reason

    def clear(self) -> None:
        self.cool_down_until = 0.0
        self.consecutive_failures = 0
        self.last_error = ""


class LLMProvider(ABC):
    name: str = "base"

    def __init__(self) -> None:
        self.health = ProviderHealth()

    @abstractmethod
    def is_configured(self) -> bool:
        """True iff we have credentials for this provider."""
        ...

    @abstractmethod
    def build_chat_model(self, tier: TaskTier, temperature: float, pipeline: Pipeline = "doc") -> Any:
        """Return a LangChain chat model instance (has .invoke/.ainvoke/.astream)."""
        ...

    @abstractmethod
    def is_rate_limit_error(self, exc: BaseException) -> tuple[bool, float | None]:
        """Return (is_rate_limited, retry_after_seconds_or_None)."""
        ...
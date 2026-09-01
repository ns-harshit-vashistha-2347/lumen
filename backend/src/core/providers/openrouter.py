from __future__ import annotations

from src.core.config import settings
from src.core.providers.base import TaskTier
from src.core.providers.openai_compat import OpenAICompatProvider


class OpenRouterProvider(OpenAICompatProvider):
    name = "openrouter"

    @property
    def base_url(self) -> str:
        return settings.OPENROUTER_BASE_URL

    @property
    def api_key(self) -> str:
        return settings.OPENROUTER_API_KEY

    def is_configured(self) -> bool:
        return bool(settings.OPENROUTER_API_KEY)

    def _model_for_tier(self, tier: TaskTier, pipeline: str = "doc") -> str:
        if pipeline == "code":
            code = {
                "small": settings.OPENROUTER_MODEL_CODE_SMALL,
                "medium": settings.OPENROUTER_MODEL_CODE_MEDIUM,
                "large": settings.OPENROUTER_MODEL_CODE_LARGE,
            }[tier]
            if code:
                return code
        return {
            "small": settings.OPENROUTER_MODEL_SMALL,
            "medium": settings.OPENROUTER_MODEL_MEDIUM,
            "large": settings.OPENROUTER_MODEL_LARGE,
        }[tier]

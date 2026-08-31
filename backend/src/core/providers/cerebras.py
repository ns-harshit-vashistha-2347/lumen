from __future__ import annotations

from src.core.config import settings
from src.core.providers.base import TaskTier
from src.core.providers.openai_compat import OpenAICompatProvider


class CerebrasProvider(OpenAICompatProvider):
    name = "cerebras"

    @property
    def base_url(self) -> str:
        return settings.CEREBRAS_BASE_URL

    @property
    def api_key(self) -> str:
        return settings.CEREBRAS_API_KEY

    def is_configured(self) -> bool:
        return bool(settings.CEREBRAS_API_KEY)

    def _model_for_tier(self, tier: TaskTier) -> str:
        return {
            "small": settings.CEREBRAS_MODEL_SMALL,
            "medium": settings.CEREBRAS_MODEL_MEDIUM,
            "large": settings.CEREBRAS_MODEL_LARGE,
        }[tier]

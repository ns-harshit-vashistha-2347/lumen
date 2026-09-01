from src.core.llm_router import RoutedChatModel, get_router
from src.core.providers.base import TASK_TO_TIER, TaskTier  # re-export

__all__ = ["get_llm", "TASK_TO_TIER", "TaskTier", "RoutedChatModel"]


def get_llm(task: str = "default", temperature: float = 0.2, pipeline: str = "doc") -> RoutedChatModel:
    return get_router().get_chat(task=task, temperature=temperature, pipeline=pipeline)

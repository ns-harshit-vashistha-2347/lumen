from slowapi import Limiter
from slowapi.util import get_remote_address

from src.core.config import settings


def _key(request) -> str:
    """Rate-limit by authenticated user when possible, else by IP."""
    user = getattr(request.state, "user", None)
    if user is not None and getattr(user, "id", None) is not None:
        return f"user:{user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=_key, storage_uri=settings.REDIS_URL)

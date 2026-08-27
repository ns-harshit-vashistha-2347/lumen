from functools import lru_cache

from src.core.config import settings
from src.core.logging import get_logger

import hashlib
import json
import redis

logger = get_logger(__name__)


@lru_cache
def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(url=settings.REDIS_URL, decode_responses=True)


def bm25_version_key(collection_name: str) -> str:
    return f"bm25:corpus_version:{collection_name}"


def bump_bm25_version(collection_name: str) -> None:
    try:
        get_redis_client().incr(bm25_version_key(collection_name))
    except redis.RedisError as exc:
        logger.warning(f"bm25 version bump failed: {exc}")


def get_bm25_version(collection_name: str) -> str:
    try:
        value = get_redis_client().get(bm25_version_key(collection_name))
    except redis.RedisError as exc:
        logger.warning(f"bm25 version read failed: {exc}")
        return "0"
    return value or "0"


def query_cache_key(query: str, top_k: int, user_id: str) -> str:
    normalized = query.strip().lower()
    digest = hashlib.sha256(f"{user_id}:{top_k}:{normalized}".encode()).hexdigest()
    return f"query_cache:{digest}"


def get_cached_query(query: str, top_k: int, user_id: str) -> dict | None:
    """Redis is a best-effort cache — never let a Redis outage take down /query."""
    try:
        raw = get_redis_client().get(query_cache_key(query, top_k, user_id))
    except redis.RedisError as exc:
        logger.warning(f"query cache read failed: {exc}")
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(f"query cache decode failed: {exc}")
        return None


def set_cached_query(query: str, top_k: int, user_id: str, payload: dict, ttl: int = 3600) -> None:
    try:
        get_redis_client().set(
            query_cache_key(query, top_k, user_id), json.dumps(payload), ex=ttl
        )
    except (redis.RedisError, TypeError, ValueError) as exc:
        logger.warning(f"query cache write failed: {exc}")
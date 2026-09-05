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


def _scope_digest(document_ids: list[str] | None) -> str:
    """Stable digest of the scope. `None` and `[]` both mean 'whole library'
    and must produce the same key so that scope is a first-class cache
    dimension. Sorted so caller order doesn't matter."""
    if not document_ids:
        return "all"
    return hashlib.sha1(",".join(sorted(document_ids)).encode()).hexdigest()[:16]


def query_cache_key(
    query: str,
    top_k: int,
    user_id: str,
    document_ids: list[str] | None = None,
) -> str:
    normalized = query.strip().lower()
    scope = _scope_digest(document_ids)
    digest = hashlib.sha256(
        f"{user_id}:{top_k}:{scope}:{normalized}".encode()
    ).hexdigest()
    return f"query_cache:{digest}"


def get_cached_query(
    query: str,
    top_k: int,
    user_id: str,
    document_ids: list[str] | None = None,
) -> dict | None:
    """Redis is a best-effort cache — never let a Redis outage take down /query."""
    try:
        raw = get_redis_client().get(
            query_cache_key(query, top_k, user_id, document_ids)
        )
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


def set_cached_query(
    query: str,
    top_k: int,
    user_id: str,
    payload: dict,
    ttl: int = 3600,
    document_ids: list[str] | None = None,
) -> None:
    # TypeError/ValueError caught alongside RedisError because json.dumps on
    # a non-serializable value (e.g. datetime, uuid) would otherwise 500 the
    # caller instead of degrading to "no cache write".
    try:
        get_redis_client().set(
            query_cache_key(query, top_k, user_id, document_ids),
            json.dumps(payload),
            ex=ttl,
        )
    except (redis.RedisError, TypeError, ValueError) as exc:
        logger.warning(f"query cache write failed: {exc}")


# ---------------------------------------------------------------------------
# LLM response cache
#
# For deterministic calls (classify / rewrite / verify with temperature=0),
# identical prompts always yield identical outputs. Cache by
# (task, model, prompt_hash) to skip repeat inference and reduce token spend.
# NEVER cache streaming or non-deterministic calls; the caller must opt in.
# ---------------------------------------------------------------------------

def _llm_key(task: str, model: str, prompt: str) -> str:
    digest = hashlib.sha1(f"{task}\x00{model}\x00{prompt}".encode("utf-8")).hexdigest()
    return f"llm:{task}:{digest}"


def get_cached_llm_response(task: str, model: str, prompt: str) -> str | None:
    try:
        raw = get_redis_client().get(_llm_key(task, model, prompt))
    except redis.RedisError as exc:
        logger.warning(f"llm cache read failed: {exc}")
        return None
    # decode_responses=True → get() returns str | None already.
    return raw


def set_cached_llm_response(
    task: str, model: str, prompt: str, response: str, ttl: int = 3600
) -> None:
    try:
        get_redis_client().set(_llm_key(task, model, prompt), response, ex=ttl)
    except redis.RedisError as exc:
        logger.warning(f"llm cache write failed: {exc}")


def _messages_to_prompt(messages) -> str:
    """Stable text serialization of LangChain messages for cache-key hashing.
    We don't need to be exact — just deterministic + collision-resistant."""
    parts = []
    for m in messages or []:
        role = getattr(m, "type", None) or getattr(m, "role", "") or "?"
        content = getattr(m, "content", "") or ""
        parts.append(f"{role}::{content}")
    return "\n\x1e\n".join(parts)


def _model_id_for(llm) -> str:
    """Best-effort model identifier for cache-key stability. Uses the router's
    task+tier when available, else the class name."""
    for attr in ("_task", "task", "model_name", "model"):
        v = getattr(llm, attr, None)
        if v:
            return str(v)
    return llm.__class__.__name__


def cached_llm_invoke(task: str, llm, messages, ttl: int | None = None) -> str:
    """Sync cached invoke for deterministic (temperature=0) prompts.
    Returns the `.content` string. Only enabled when
    settings.LLM_RESPONSE_CACHE_ENABLED. Falls through on any cache failure."""
    from src.core.config import settings as _s
    if not _s.LLM_RESPONSE_CACHE_ENABLED:
        return llm.invoke(messages).content
    model = _model_id_for(llm)
    prompt = _messages_to_prompt(messages)
    hit = get_cached_llm_response(task, model, prompt)
    if hit is not None:
        logger.info(f"[llm cache] HIT task={task} model={model}")
        return hit
    resp = llm.invoke(messages)
    content = resp.content or ""
    set_cached_llm_response(task, model, prompt, content, ttl=ttl or _s.LLM_RESPONSE_CACHE_TTL)
    return content


async def cached_llm_ainvoke(task: str, llm, messages, ttl: int | None = None) -> str:
    from src.core.config import settings as _s
    if not _s.LLM_RESPONSE_CACHE_ENABLED:
        r = await llm.ainvoke(messages)
        return r.content
    model = _model_id_for(llm)
    prompt = _messages_to_prompt(messages)
    hit = get_cached_llm_response(task, model, prompt)
    if hit is not None:
        logger.info(f"[llm cache] HIT task={task} model={model}")
        return hit
    resp = await llm.ainvoke(messages)
    content = resp.content or ""
    set_cached_llm_response(task, model, prompt, content, ttl=ttl or _s.LLM_RESPONSE_CACHE_TTL)
    return content


# ---------------------------------------------------------------------------
# Query-embedding cache
#
# Embedding the SAME text twice on CPU costs ~50-200ms per hit. In this app a
# single request often embeds the same string multiple times: the primary
# query + N rewrites often overlap, and users retry / paginate the same
# question. Cache by (model, text) so repeats become a cheap Redis GET.
# ---------------------------------------------------------------------------

def _embedding_key(model_name: str, text: str) -> str:
    digest = hashlib.sha1(f"{model_name}\x00{text}".encode("utf-8")).hexdigest()
    return f"emb:q:{digest}"


# In-process LRU in front of Redis. A hot query (e.g. a common sample or a
# retried request) becomes a dict lookup instead of a Redis round-trip
# (~0.5-1ms). Bounded so a bursty workload can't blow RAM.
from collections import OrderedDict
import threading

_EMB_LRU_MAX = 2048
_EMB_LRU: "OrderedDict[str, list[float]]" = OrderedDict()
_EMB_LRU_LOCK = threading.Lock()


def _lru_get(key: str) -> list[float] | None:
    with _EMB_LRU_LOCK:
        v = _EMB_LRU.get(key)
        if v is not None:
            _EMB_LRU.move_to_end(key)
        return v


def _lru_put(key: str, vec: list[float]) -> None:
    with _EMB_LRU_LOCK:
        _EMB_LRU[key] = vec
        _EMB_LRU.move_to_end(key)
        while len(_EMB_LRU) > _EMB_LRU_MAX:
            _EMB_LRU.popitem(last=False)


def get_cached_embedding(model_name: str, text: str) -> list[float] | None:
    key = _embedding_key(model_name, text)
    hit = _lru_get(key)
    if hit is not None:
        return hit
    try:
        raw = get_redis_client().get(key)
    except redis.RedisError as exc:
        logger.warning(f"embedding cache read failed: {exc}")
        return None
    if not raw:
        return None
    try:
        vec = json.loads(raw)
        if isinstance(vec, list):
            _lru_put(key, vec)
            return vec
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(f"embedding cache decode failed: {exc}")
    return None


def set_cached_embedding(model_name: str, text: str, vector: list[float], ttl: int = 86400) -> None:
    key = _embedding_key(model_name, text)
    _lru_put(key, vector)
    try:
        get_redis_client().set(key, json.dumps(vector), ex=ttl)
    except (redis.RedisError, TypeError, ValueError) as exc:
        logger.warning(f"embedding cache write failed: {exc}")
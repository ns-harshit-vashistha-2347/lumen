from src.core.cache import _scope_digest, query_cache_key


def test_scope_digest_is_order_independent():
    a = _scope_digest(["a", "b", "c"])
    b = _scope_digest(["c", "a", "b"])
    assert a == b


def test_scope_digest_treats_none_and_empty_as_same():
    assert _scope_digest(None) == _scope_digest([])
    assert _scope_digest(None) == "all"


def test_query_cache_key_isolates_users_and_scopes():
    k1 = query_cache_key("hi", 5, "user-A", ["doc-1"])
    k2 = query_cache_key("hi", 5, "user-B", ["doc-1"])
    k3 = query_cache_key("hi", 5, "user-A", ["doc-2"])
    k4 = query_cache_key("hi", 5, "user-A", ["doc-1"])
    assert k1 != k2
    assert k1 != k3
    assert k1 == k4


def test_query_cache_key_is_case_insensitive_and_trims():
    assert query_cache_key("  Hi ", 5, "u", None) == query_cache_key("hi", 5, "u", None)

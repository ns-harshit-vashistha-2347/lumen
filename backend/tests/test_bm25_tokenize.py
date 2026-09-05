from src.nodes.retrieval.bm25 import _tokenize, _split_identifier


def test_camelcase_splits_and_lowercases():
    toks = set(_tokenize("getUserById"))
    assert "get" in toks
    assert "user" in toks
    # "Id" → "id", but "id" is also often a stopword-ish 2-char; we keep it.
    assert "id" in toks


def test_snake_case_splits():
    toks = set(_tokenize("get_user_id"))
    assert {"get", "user", "id"}.issubset(toks)


def test_stopwords_are_dropped():
    toks = _tokenize("the quick brown fox")
    assert "the" not in toks
    assert "quick" in toks
    assert "brown" in toks
    assert "fox" in toks


def test_identifier_splitter_preserves_original_and_parts():
    parts = _split_identifier("HTTPServer")
    assert "HTTPServer" in parts
    # camel split should surface at least one of these
    assert any(p in {"HTTP", "Server"} for p in parts)


def test_empty_and_punctuation_only_returns_empty():
    assert _tokenize("") == []
    assert _tokenize("---!!!???") == []

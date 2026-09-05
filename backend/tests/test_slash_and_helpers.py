from src.graphs.query_graph import _fast_classify
from src.core.errors import ApiError


def test_fast_classify_marks_short_factual_as_simple():
    assert _fast_classify("who wrote this document?") == "simple"
    assert _fast_classify("what is RAG") == "simple"


def test_fast_classify_marks_multi_hop_as_complex():
    assert _fast_classify("compare A and B") == "complex"
    assert _fast_classify("summarize each of the following topics in detail across all documents") == "complex"


def test_fast_classify_returns_none_when_unsure():
    # 13-word non-marker query — over the "8 words" bar but under 20 and
    # not obviously multi-hop → let the LLM decide.
    assert _fast_classify("please tell me about the authentication flow used in the api gateway") is None


def test_api_error_defaults_code_from_status():
    e = ApiError(404, "gone")
    assert e.code == "not_found"
    assert e.message == "gone"
    e2 = ApiError(500, "boom", code="pipeline_failure")
    assert e2.code == "pipeline_failure"

import asyncio
import time

from rank_bm25 import BM25Okapi
import re

from src.core.cache import get_bm25_version
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.interfaces.base_retriever import BaseRetriever, RetrievedChunk
from src.core.config import settings
from src.nodes.retrieval.fusion import reciprocal_rank_fusion

logger = get_logger(__name__)

# Cache keyed by (collection_name, user_id_or_none) so multi-tenant traffic
# does not blow the whole index away on every user switch, and so per-tenant
# indexes stay small (tokenizing another user's chunks was pure waste).
_BM25_CACHE: dict[tuple[str, str | None], tuple] = {}

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CAMEL_RE = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|\d+")

_STOPWORDS = frozenset({
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "of", "to", "in", "on", "at", "by", "for", "with", "as", "from", "into",
    "and", "or", "but", "not", "no",
    "this", "that", "these", "those", "it", "its", "there", "here",
    "do", "does", "did", "done", "have", "has", "had",
    "i", "you", "he", "she", "we", "they", "them", "us", "me", "my", "your", "our",
    "so", "if", "then", "than", "because",
    "can", "will", "would", "should", "could", "may", "might",
})

try:  # pragma: no cover — depends on env
    from nltk.stem.snowball import SnowballStemmer  # type: ignore

    _stemmer = SnowballStemmer("english")

    def _stem(t: str) -> str:
        return _stemmer.stem(t)
except Exception:
    _stemmer = None

    def _stem(t: str) -> str:
        return t


def _split_identifier(raw: str) -> list[str]:
    pieces = [raw]
    if "_" in raw:
        pieces.extend(p for p in raw.split("_") if p)
    if any(c.isupper() for c in raw):
        pieces.extend(m.group(0) for m in _CAMEL_RE.finditer(raw))
    return pieces


def _tokenize(text: str) -> list[str]:
    out: list[str] = []
    for raw in re.findall(r"[A-Za-z0-9]+", text):
        for piece in _split_identifier(raw):
            low = piece.lower()
            if not low or low in _STOPWORDS:
                continue
            out.append(_stem(low))
    return out

class BM25Retriever(BaseRetriever):
    def __init__(self, collection_name: str):
        self.collection = get_collections(collection_name)

    def _load_corpus(self, user_id: str | None):
        # Push the user_id filter down to Chroma. Prior version pulled every
        # tenant's chunks and filtered in Python — O(all users) per rebuild.
        where = {"user_id": user_id} if user_id else None
        data = self.collection.get(include=["metadatas", "documents"], where=where)
        return data.get("ids", []), data.get("documents", []), data.get("metadatas", [])

    def _get_index(self, user_id: str | None):
        name = self.collection.name
        key = (name, user_id)
        current_version = get_bm25_version(name)
        cached = _BM25_CACHE.get(key)

        if cached is not None:
            cached_version, built_at, bm25, ids, documents, metadatas = cached
            is_fresh = (time.time() - built_at) < settings.BM25_CACHE_TTL_SECONDS
            if cached_version == current_version and is_fresh:
                return bm25, ids, documents, metadatas
            # Stale by TTL but corpus hasn't changed → just bump built_at
            # so we don't re-tokenize the whole corpus each TTL cycle.
            if cached_version == current_version:
                _BM25_CACHE[key] = (cached_version, time.time(), bm25, ids, documents, metadatas)
                return bm25, ids, documents, metadatas

        logger.info(
            f"[BM25Retriever] rebuilding index for '{name}' user={user_id} (version={current_version})"
        )
        ids, documents, metadatas = self._load_corpus(user_id)
        bm25 = BM25Okapi([_tokenize(doc) for doc in documents]) if documents else None
        _BM25_CACHE[key] = (current_version, time.time(), bm25, ids, documents, metadatas)
        return bm25, ids, documents, metadatas

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        user_id: str | None = None,
        document_ids: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        bm25, ids, documents, metadatas = self._get_index(user_id)

        if not documents or bm25 is None:
            return []

        tokenized_query = _tokenize(query)
        scores = bm25.get_scores(tokenized_query)

        combined = list(zip(ids, documents, metadatas, scores))
        if document_ids:
            allow = set(document_ids)
            combined = [row for row in combined if (row[2] or {}).get("document_id") in allow]

        ranked = sorted(combined, key=lambda x: x[3], reverse=True)[:top_k]

        return [
            RetrievedChunk(
                id=chunk_id,
                content=doc,
                metadata=metadata,
                score=float(score)
            )
            for chunk_id, doc, metadata, score in ranked
        ]


# One retriever per collection is enough — the actual index cache is keyed
# by (collection, user_id) inside the retriever, so this stays tenant-safe.
_RETRIEVERS: dict[str, BM25Retriever] = {}


def _get_retriever(collection_name: str) -> BM25Retriever:
    r = _RETRIEVERS.get(collection_name)
    if r is None:
        r = BM25Retriever(collection_name)
        _RETRIEVERS[collection_name] = r
    return r


async def bm25_retrieval_node(state: dict) -> dict:
    queries = state.get("queries") or [state["query"]]
    retrieval_k = state.get("retrieval_k", state.get("top_k", 5))
    user_id = state.get("user_id")
    document_ids = state.get("document_ids")
    logger.info(
        f"[bm25_retrieval_node] searching {len(queries)} query variants, "
        f"retrieval_k={retrieval_k} user_id={user_id} document_ids={document_ids}"
    )

    retriever = _get_retriever(settings.CHROMA_COLLECTION_DOCUMENTS)

    per_query_results = await asyncio.gather(*[
        asyncio.to_thread(
            retriever.retrieve, q, retrieval_k, user_id, document_ids
        )
        for q in queries
    ])
    fused = reciprocal_rank_fusion(per_query_results)[:retrieval_k]

    return {"bm25_results": fused}

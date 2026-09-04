import asyncio
import time

from rank_bm25 import BM25Okapi
import re

from src.core.cache import get_bm25_version
from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.interfaces.base_retriever import BaseRetriever, RetrievedChunk
from src.core.config import settings

logger = get_logger(__name__)

_BM25_CACHE: dict[str, tuple] = {}

# Extract [a-z0-9]+ tokens AND split CamelCase / snake_case into constituents
# so a query for "getUser" also matches "get_user" and vice-versa. Keeps the
# original token too so exact matches still score.
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

# Snowball stemmer is optional — if installed, we use it. If not, we still
# get camelCase/snake_case splitting + stopwording which is already a
# meaningful upgrade over the previous 12-word stoplist.
try:  # pragma: no cover — depends on env
    from nltk.stem.snowball import SnowballStemmer  # type: ignore

    _stemmer = SnowballStemmer("english")

    def _stem(t: str) -> str:
        return _stemmer.stem(t)
except Exception:  # nltk not installed or data missing
    _stemmer = None

    def _stem(t: str) -> str:
        return t


def _split_identifier(raw: str) -> list[str]:
    """Split a single alphanumeric token on camelCase / snake_case boundaries.
    "getUserById" → ["getUserById", "get", "User", "By", "Id"]
    "get_user_id" → ["get_user_id", "get", "user", "id"]
    Returned pieces preserve their case; downstream will lowercase."""
    pieces = [raw]
    if "_" in raw:
        pieces.extend(p for p in raw.split("_") if p)
    if any(c.isupper() for c in raw):
        pieces.extend(m.group(0) for m in _CAMEL_RE.finditer(raw))
    return pieces


def _tokenize(text: str) -> list[str]:
    """Extract case-preserving alphanumeric tokens → split camelCase /
    snake_case → lowercase → drop stopwords → optional Snowball stem.

    Cached indexes rebuild every BM25_CACHE_TTL_SECONDS, so changes here
    take at most one TTL cycle to apply."""
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

    def _load_corpus(self):
        data = self.collection.get(include=["metadatas", "documents"])
        ids = data.get("ids", [])
        documents = data.get("documents", [])
        metadatas = data.get("metadatas", [])

        return ids, documents, metadatas

    def _get_index(self):
        name = self.collection.name
        current_version = get_bm25_version(name)
        cached = _BM25_CACHE.get(name)

        if cached is not None:
            cached_version, built_at, bm25, ids, documents, metadatas = cached
            is_fresh = (time.time() - built_at) < settings.BM25_CACHE_TTL_SECONDS
            if cached_version == current_version:
                if not is_fresh:
                    _BM25_CACHE[name] = (cached_version, time.time(), bm25, ids, documents, metadatas)
                return bm25, ids, documents, metadatas

        logger.info(f"[BM25Retriever] rebuilding index for '{name}' (version={current_version})")
        ids, documents, metadatas = self._load_corpus()
        bm25 = BM25Okapi([_tokenize(doc) for doc in documents]) if documents else None
        _BM25_CACHE[name] = (current_version, time.time(), bm25, ids, documents, metadatas)
        return bm25, ids, documents, metadatas

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        user_id: str | None = None,
        document_ids: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        bm25, ids, documents, metadatas = self._get_index()

        if not documents or bm25 is None:
            return []

        tokenized_query = _tokenize(query)
        scores = bm25.get_scores(tokenized_query)

        combined = list(zip(ids, documents, metadatas, scores))
        if user_id is not None:
            combined = [row for row in combined if (row[2] or {}).get("user_id") == user_id]
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


async def bm25_retrieval_node(state: dict) -> dict:
    from src.nodes.retrieval.fusion import reciprocal_rank_fusion

    queries = state.get("queries") or [state["query"]]
    retrieval_k = state.get("retrieval_k", state.get("top_k", 5))
    user_id = state.get("user_id")
    document_ids = state.get("document_ids")
    logger.info(
        f"[bm25_retrieval_node] searching {len(queries)} query variants, "
        f"retrieval_k={retrieval_k} user_id={user_id} document_ids={document_ids}"
    )

    retriever = BM25Retriever(settings.CHROMA_COLLECTION_DOCUMENTS)

    per_query_results = await asyncio.gather(*[
        asyncio.to_thread(
            retriever.retrieve, q, retrieval_k, user_id, document_ids
        )
        for q in queries
    ])
    fused = reciprocal_rank_fusion(per_query_results)[:retrieval_k]

    return {"bm25_results": fused}

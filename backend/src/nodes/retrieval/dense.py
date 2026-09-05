import asyncio
import time

from src.core.logging import get_logger
from src.core.vectorstore import get_collections
from src.interfaces.base_retriever import BaseRetriever, RetrievedChunk
from src.nodes.ingestion.embed import get_embedder
from src.nodes.retrieval.fusion import reciprocal_rank_fusion
from src.core.config import settings


logger = get_logger(__name__)



class DenseRetriever(BaseRetriever):
    def __init__(self, collection_name: str):
        self.collection = get_collections(collection_name)
        self.embedder = get_embedder()


    def retrieve(
        self,
        query: str,
        top_k: int,
        user_id: str | None = None,
        document_ids: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        query_embedding = self.embedder.embed_query(query)
        conditions = []
        if user_id:
            conditions.append({"user_id": user_id})
        if document_ids:
            if len(document_ids) == 1:
                conditions.append({"document_id": document_ids[0]})
            else:
                conditions.append({"document_id": {"$in": document_ids}})

        where = {"$and": conditions} if len(conditions) > 1 else (conditions[0] if conditions else None)
        # Small retry loop for transient Chroma HTTP blips (503, timeout, reset).
        # 3 tries with jittered backoff — Chroma is either up or it isn't, so
        # short and total-timeout-bounded.
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                results = self.collection.query(
                    query_embeddings=[query_embedding], n_results=top_k, where=where
                )
                break
            except Exception as exc:  # noqa: BLE001 — chroma raises many types
                last_exc = exc
                if attempt == 2:
                    raise
                delay = 0.15 * (2 ** attempt) + (0.05 * attempt)
                logger.warning(
                    f"[dense] chroma query failed (attempt {attempt+1}/3): {exc}; "
                    f"retrying in {delay:.2f}s"
                )
                time.sleep(delay)
        else:  # pragma: no cover — unreachable, break-or-raise above
            raise last_exc or RuntimeError("chroma query failed")


        chunks = []
        ids = results.get("ids", [[]])[0]
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for chunk_id, content, metadata, distance in zip(ids, documents, metadatas, distances):
            score = 1 / (1 + distance)
            chunks.append(RetrievedChunk(id=chunk_id, content=content, metadata=metadata, score=score))

        return chunks


# One DenseRetriever per collection. The retriever itself only owns a
# reference to the (cached) collection + embedder, so this is a cheap way
# to avoid re-fetching the collection handle on every request.
_DENSE_RETRIEVERS: dict[str, "DenseRetriever"] = {}


def _get_dense_retriever(collection_name: str) -> "DenseRetriever":
    r = _DENSE_RETRIEVERS.get(collection_name)
    if r is None:
        r = DenseRetriever(collection_name)
        _DENSE_RETRIEVERS[collection_name] = r
    return r


async def dense_retrieval_node(state: dict) -> dict:
    queries = state.get("queries") or [state["query"]]
    retrieval_k = state.get("retrieval_k", state.get("top_k", 5))
    user_id = state.get("user_id")
    document_ids = state.get("document_ids")

    logger.info(
        f"[dense_retrieval_node] searching {len(queries)} query variants, "
        f"retrieval_k={retrieval_k} user_id={user_id} document_ids={document_ids}"
    )

    retriever = _get_dense_retriever(settings.CHROMA_COLLECTION_DOCUMENTS)

    # embed_query + chroma.query are both blocking; run them off the event loop
    # so concurrent requests aren't serialized behind each other.
    per_query_results = await asyncio.gather(*[
        asyncio.to_thread(
            retriever.retrieve, q, retrieval_k, user_id, document_ids
        )
        for q in queries
    ])
    fused = reciprocal_rank_fusion(per_query_results)[:retrieval_k]

    return {"dense_results": fused}
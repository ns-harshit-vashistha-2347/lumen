from fastapi import APIRouter, Depends, HTTPException, Request

from src.core.deps import get_current_user
from src.core.logging import get_logger
from src.core.rate_limit import limiter
from src.graphs.query_graph import query_graph, retrieval_graph
from src.models.user import User
from src.schemas.document import QueryRequest, QueryResponse, SourceChunk
from src.core.cache import get_cached_query, set_cached_query
from fastapi.responses import StreamingResponse
from src.core.llm import get_llm
from langchain_core.messages import HumanMessage, SystemMessage
from src.nodes.retrieval.generation import SYSTEM_PROMPT, _build_context, _pick_chunks


query_router = APIRouter(prefix="/query", tags=["query"])
logger = get_logger(__name__)


@query_router.post("", response_model=QueryResponse)
@limiter.limit("30/minute")
async def run_query(
    request: Request,
    payload: QueryRequest,
    current_user: User = Depends(get_current_user),
):
    logger.info(
        f"[/query] user_id={current_user.id} query='{payload.query[:60]}' top_k={payload.top_k}"
    )

    cached = get_cached_query(payload.query, payload.top_k, str(current_user.id))
    if cached is not None:
        logger.info(f"[/query] cache hit user_id={current_user.id}")
        return QueryResponse(**cached)

    try:
        result = await query_graph.ainvoke({
            "query": payload.query,
            "top_k": payload.top_k,
            "user_id": str(current_user.id),
            "document_ids": [str(d) for d in payload.document_ids] if payload.document_ids else None,
        })
    except Exception as exc:
        logger.exception(
            f"[/query] graph execution failed user_id={current_user.id}: {exc}"
        )
        raise HTTPException(status_code=500, detail="Query pipeline failed") from exc

    source_chunks = (
        result.get("compressed_results")
        or result.get("reranked_results")
        or result.get("fused_results", [])
    )
    sources = [
        SourceChunk(
            content=c.metadata.get("original_content") or c.metadata.get("raw_content", c.content),
            metadata=c.metadata,
            score=c.score,
        )
        for c in source_chunks
    ]

    response = QueryResponse(answer=result.get("answer", ""), sources=sources)
    set_cached_query(payload.query, payload.top_k, str(current_user.id), response.model_dump(mode="json"))
    return response


@query_router.post("/stream")
async def run_query_stream(payload: QueryRequest, current_user: User = Depends(get_current_user)):
    partial = await retrieval_graph.ainvoke({
        "query": payload.query,
        "top_k": payload.top_k,
        "user_id": str(current_user.id),
        "document_ids": [str(d) for d in payload.document_ids] if payload.document_ids else None,
    })
    chunks = _pick_chunks(partial)
    context = _build_context(chunks)
    complexity = partial.get("complexity", "complex")
    task_name = "generate_simple" if complexity == "simple" else "generate_complex"
    llm = get_llm(task=task_name, temperature=0.2)

    async def token_stream():
        async for chunk in llm.astream([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"Context:\n\n{context}\n\nQuestion: {payload.query}"),
        ]):
            yield chunk.content

    return StreamingResponse(token_stream(), media_type="text/plain")


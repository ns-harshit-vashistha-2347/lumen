from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from src.core.config import settings
from src.core.logging import get_logger, setup_logging
from src.core.rate_limit import limiter
from src.routes.auth import auth_router
from src.routes.documents import document_router
from src.routes.query import query_router
from src.routes.status import status_router
from src.routes.repos import repos_router
from src.routes.code_query import code_query_router
from src.routes.webhooks import webhook_router
from src.routes.chat import chat_router

from src.core.fallback_middleware import LLMFallbackMiddleware

from src.nodes.ingestion.embed import get_embedder
from src.nodes.retrieval.rerank import get_reranker

setup_logging()
logger = get_logger(__name__)



@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} [{settings.ENV}]")
    # Warm every model the request path uses so the first /query or
    # /code-query/stream doesn't pay 20-40s of cold model loading. Both
    # pipelines get warmed; a warm HFEmbedder is a no-op on the second call.
    import asyncio as _asyncio

    async def _warm() -> None:
        # Fire loads in threads so a slow model download doesn't block startup
        # of the other one. Failures are logged but non-fatal — the request
        # path will retry (and surface the real error) on first use.
        async def _safe(label: str, fn):
            try:
                await _asyncio.to_thread(fn)
                logger.info(f"[warmup] {label} ready")
            except Exception as exc:
                logger.warning(f"[warmup] {label} failed: {exc}")

        tasks = [
            _safe("embedder:doc",  lambda: get_embedder(pipeline="doc")),
            _safe("embedder:code", lambda: get_embedder(pipeline="code")),
        ]
        if settings.RERANK_ENABLED:
            tasks.append(_safe("reranker:doc",  lambda: get_reranker(pipeline="doc")))
            tasks.append(_safe("reranker:code", lambda: get_reranker(pipeline="code")))
        await _asyncio.gather(*tasks)

    await _warm()
    yield
    logger.info("Shutting down")


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(LLMFallbackMiddleware)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-LLM-Fallback"],
)

app.include_router(auth_router)
app.include_router(document_router)
app.include_router(status_router)
app.include_router(query_router)
app.include_router(repos_router)
app.include_router(code_query_router)
app.include_router(webhook_router)
app.include_router(chat_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.ENV}

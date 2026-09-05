from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from src.core.config import settings
from src.core.errors import register_error_handlers
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
from src.routes.evals import evals_router

from src.core.fallback_middleware import LLMFallbackMiddleware

from src.nodes.ingestion.embed import get_embedder
from src.nodes.retrieval.rerank import get_reranker

setup_logging()
logger = get_logger(__name__)


def _prod_secret_check() -> None:
    """Refuse to boot in prod with placeholder/missing secrets. Local dev
    still runs so nothing changes for iteration, but a mis-deployed prod
    build fails loudly instead of running with a well-known JWT key."""
    if settings.ENV.lower() in {"local", "dev", "development", "test"}:
        return
    problems: list[str] = []
    if settings.JWT_SECRET_KEY in ("", "change-me-in-production-please"):
        problems.append("JWT_SECRET_KEY must be set to a strong random value")
    if not settings.REPO_TOKEN_ENCRYPTION_KEY:
        problems.append(
            "REPO_TOKEN_ENCRYPTION_KEY must be set (Fernet.generate_key().decode())"
        )
    if problems:
        raise RuntimeError(
            "Refusing to start in ENV=" + settings.ENV + ": " + "; ".join(problems)
        )


_prod_secret_check()



@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} [{settings.ENV}]")
    # Warm ONLY the doc pipeline eagerly. Code models are big (hundreds of
    # MB, 20-40s cold) and are only needed by /code-query — lazy-load them
    # on first use so a doc-only user never pays the cost.
    import asyncio as _asyncio

    async def _warm() -> None:
        async def _safe(label: str, fn):
            try:
                await _asyncio.to_thread(fn)
                logger.info(f"[warmup] {label} ready")
            except Exception as exc:
                logger.warning(f"[warmup] {label} failed: {exc}")

        tasks = [_safe("embedder:doc", lambda: get_embedder(pipeline="doc"))]
        if settings.RERANK_ENABLED:
            tasks.append(_safe("reranker:doc", lambda: get_reranker(pipeline="doc")))
        await _asyncio.gather(*tasks)

    await _warm()
    yield
    logger.info("Shutting down")


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(LLMFallbackMiddleware)
# Compress JSON responses (source lists, chunk pages, session lists) that
# are large but text-shaped. min_size skips tiny bodies. Streaming
# text/plain answers are unaffected — starlette leaves them alone.
app.add_middleware(GZipMiddleware, minimum_size=1024)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    expose_headers=["X-LLM-Fallback"],
)

register_error_handlers(app)

app.include_router(auth_router)
app.include_router(document_router)
app.include_router(status_router)
app.include_router(query_router)
app.include_router(repos_router)
app.include_router(code_query_router)
app.include_router(webhook_router)
app.include_router(chat_router)
app.include_router(evals_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.ENV}

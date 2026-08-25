from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    PROJECT_NAME: str = "AI World Backend"
    APP_NAME: str = "AI World Backend"
    ENV: str = "local"

    # Controls sentence-transformers/huggingface_hub network access at
    # runtime. Only set this to "1" once BAAI/bge-large-en-v1.5 (or
    # whichever EMBEDDING_MODEL you use) is already cached locally
    # (e.g. baked into the image or in a mounted HF cache volume) --
    # otherwise embedding calls fail with a connection error because
    # the model can't be downloaded.
    HF_HUB_OFFLINE: str = "0"

    POSTGRES_USER: str = "world"
    POSTGRES_PASSWORD: str = "world"
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str = "world"
    # Managed providers (Neon, Supabase) require TLS. Set to "require" in prod.
    POSTGRES_SSL_MODE: str = ""
    # If set, ignore the components above and use this exact URL (async driver).
    # Handy for Neon/Supabase where they hand you a full connection string.
    POSTGRES_URL_OVERRIDE: str = ""

    @property
    def POSTGRES_URL(self) -> str:
        if self.POSTGRES_URL_OVERRIDE:
            url = self.POSTGRES_URL_OVERRIDE
            # accept either scheme; normalize to asyncpg
            url = url.replace("postgres://", "postgresql://")
            if "+asyncpg" not in url:
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return url
        base = f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        if self.POSTGRES_SSL_MODE:
            # asyncpg uses `ssl=`, not `sslmode=`
            base += f"?ssl={self.POSTGRES_SSL_MODE}"
        return base

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    # If set, all three redis roles (cache, broker, result) share this URL.
    # Upstash free tier is single-DB, so DB indices are ignored anyway.
    REDIS_URL_OVERRIDE: str = ""

    @property
    def SYNC_POSTGRES_URL_STR(self) -> str:
        if self.POSTGRES_URL_OVERRIDE:
            url = self.POSTGRES_URL_OVERRIDE
            url = url.replace("postgres://", "postgresql://")
            url = url.replace("+asyncpg", "")
            if "+psycopg2" not in url:
                url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
            return url
        base = f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        if self.POSTGRES_SSL_MODE:
            base += f"?sslmode={self.POSTGRES_SSL_MODE}"
        return base


    @property
    def REDIS_URL(self) -> str:
        if self.REDIS_URL_OVERRIDE:
            return self.REDIS_URL_OVERRIDE
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    @property
    def CELERY_BROKER_URL(self) -> str:
        if self.REDIS_URL_OVERRIDE:
            return self.REDIS_URL_OVERRIDE
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/1"

    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        if self.REDIS_URL_OVERRIDE:
            return self.REDIS_URL_OVERRIDE
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/2"


    CHROMA_HOST: str = "chromadb"
    CHROMA_PORT: int = 8000
    CHROMA_COLLECTION_DOCUMENTS: str = "documents"
    # "http" for docker-compose (uses CHROMA_HOST/PORT), "embedded" for
    # single-container deploys (uses CHROMA_PERSIST_PATH).
    CHROMA_MODE: str = "http"
    CHROMA_PERSIST_PATH: str = "/app/chroma_data"

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    GROQ_MODEL_SMALL: str = "openai/gpt-oss-120b"
    GROQ_MODEL_MEDIUM: str = "openai/gpt-oss-120b"
    GROQ_MODEL_LARGE: str = "openai/gpt-oss-120b"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL_SMALL: str = "gemini-2.0-flash-lite-001"
    GEMINI_MODEL_MEDIUM: str = "gemini-2.0-flash-001"
    GEMINI_MODEL_LARGE: str = "gemini-2.0-flash-001"


    QUERY_CLASSIFIER_ENABLED: bool = True

    EMBEDDING_MODEL: str = "BAAI/bge-large-en-v1.5"
    # "" = auto-detect (cuda > mps > cpu). Override with "cuda" | "mps" | "cpu".
    EMBEDDING_DEVICE: str = ""

    UPLOAD_DIR: str = "/data/uploads"

    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 150

    RETRIEVAL_TOP_K: int = 5
    RRF_K: int = 60


    RERANK_ENABLED: bool = True
    RERANK_MODEL: str = "BAAI/bge-reranker-base"
    RERANK_CANDIDATE_POOL: int = 8
    RERANK_TOP_N: int = 5
    RERANK_BATCH_SIZE: int = 32
    RERANK_MAX_LENGTH: int = 512
    # "" = auto-detect (cuda > mps > cpu). Override with "cuda" | "mps" | "cpu".
    RERANK_DEVICE: str = ""


    BM25_CACHE_TTL_SECONDS: int = 300

    MAX_UPLOAD_SIZE_MB: int = 50

    QUERY_REWRITE_ENABLED: bool = True
    QUERY_EXPANSION_COUNT: int = 0  # 0 = only the LLM-cleaned "primary" + raw

    COMPRESSION_ENABLED: bool = True
    COMPRESSION_MIN_CHARS: int = 4000

    SELF_CORRECTION_ENABLED: bool = True
    SELF_CORRECTION_EXPANDED_K: int = 10


    JWT_SECRET_KEY: str = "change-me-in-production-please"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALLOWED_EXTENSIONS: str = ".pdf,.docx,.md,.txt"

    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8080/auth/google/callback"
    FRONTEND_URL: str = "http://localhost:3000"

    MMR_ENABLED: bool = True

    @property
    def allowed_extensions(self) -> frozenset[str]:
        return frozenset(
            ext.strip().lower() if ext.strip().startswith(".") else f".{ext.strip().lower()}"
            for ext in self.ALLOWED_EXTENSIONS.split(",")
            if ext.strip()
        )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
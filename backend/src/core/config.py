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

    @property
    def POSTGRES_URL(self) -> str:
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    @property
    def SYNC_POSTGRES_URL_STR(self) -> str:
        return f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"


    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    @property
    def CELERY_BROKER_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/1"

    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/2"


    CHROMA_HOST: str = "chromadb"
    CHROMA_PORT: int = 8000
    CHROMA_COLLECTION_DOCUMENTS: str = "documents"

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    GROQ_MODEL_SMALL: str = "llama-3.1-8b-instant"
    GROQ_MODEL_MEDIUM: str = "llama-3.3-70b-versatile"
    GROQ_MODEL_LARGE: str = "llama-3.3-70b-versatile"
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
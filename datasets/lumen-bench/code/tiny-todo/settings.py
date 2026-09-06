import os


class Settings:
    """Configuration loaded from environment. Deliberately tiny — no
    pydantic-settings dependency so the fixture stays trivial."""

    DATABASE_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./tiny_todo.db")
    JWT_SECRET: str = os.environ.get("JWT_SECRET", "dev-secret-change-me")
    JWT_ALGORITHM: str = "HS256"
    JWT_TTL_MINUTES: int = int(os.environ.get("JWT_TTL_MINUTES", "60"))
    MAX_TODOS_PER_USER: int = int(os.environ.get("MAX_TODOS_PER_USER", "500"))


settings = Settings()

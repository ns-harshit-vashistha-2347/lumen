from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.core.config import settings

engine = create_async_engine(
    settings.POSTGRES_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,        
    max_overflow=20,
    pool_recycle=1800,   
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_models() -> None:
    """Dev-only helper. Use Alembic migrations for anything beyond local scratch work."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
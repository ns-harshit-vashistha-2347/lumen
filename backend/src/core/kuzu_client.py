from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import kuzu

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)


SCHEMA_DDL: list[str] = [
    # Nodes
    "CREATE NODE TABLE IF NOT EXISTS File("
    "  path STRING, language STRING, PRIMARY KEY(path)"
    ")",
    "CREATE NODE TABLE IF NOT EXISTS Symbol("
    "  id STRING, name STRING, kind STRING, file_path STRING,"
    "  start_line INT64, end_line INT64, PRIMARY KEY(id)"
    ")",
    "CREATE NODE TABLE IF NOT EXISTS Module("
    "  name STRING, PRIMARY KEY(name)"
    ")",
    # Relationships
    "CREATE REL TABLE IF NOT EXISTS DEFINES(FROM File TO Symbol)",
    "CREATE REL TABLE IF NOT EXISTS IMPORTS(FROM File TO File)",
    "CREATE REL TABLE IF NOT EXISTS IMPORTS_MODULE(FROM File TO Module, alias STRING)",
    "CREATE REL TABLE IF NOT EXISTS CALLS(FROM Symbol TO Symbol, count INT64)",
    "CREATE REL TABLE IF NOT EXISTS CALLS_UNRESOLVED(FROM Symbol TO Symbol, count INT64)",
    "CREATE REL TABLE IF NOT EXISTS INHERITS(FROM Symbol TO Symbol)",
]


def kuzu_path(repo_id: str) -> Path:
    return Path(settings.KUZU_DIR) / repo_id.replace("-", "")


def ensure_schema(conn: kuzu.Connection) -> None:
    for ddl in SCHEMA_DDL:
        conn.execute(ddl)


@contextmanager
def kuzu_connection(repo_id: str, *, create: bool = True) -> Iterator[kuzu.Connection]:
    path = kuzu_path(repo_id)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    elif not path.exists():
        raise FileNotFoundError(f"No Kuzu DB for repo {repo_id}")

    db = kuzu.Database(str(path))
    try:
        conn = kuzu.Connection(db)
        if create:
            ensure_schema(conn)
        yield conn
    finally:
        close = getattr(db, "close", None)
        if callable(close):
            close()


def drop_kuzu(repo_id: str) -> None:
    path = kuzu_path(repo_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
        logger.info(f"[kuzu] dropped graph db for repo {repo_id}")


def reset_repo_graph(repo_id: str) -> None:
    """Wipe and re-init. Called at the start of graph_build so a refresh
    rebuilds from scratch instead of accumulating stale edges."""
    drop_kuzu(repo_id)
    kuzu_path(repo_id).mkdir(parents=True, exist_ok=True)


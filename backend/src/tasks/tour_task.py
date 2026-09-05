"""Generate a "how do I read this repo" markdown tour after ingest.

Runs once at the end of a successful ingest (or via user-initiated
regenerate). Cheap by design — reads the on-disk clone if it's still
around, else pulls the top-level files from Chroma, then asks a single
LLM to synthesise a README-style tour. Cached on Repo.tour_markdown.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from src.celery_app import celery_app
from src.core.config import settings
from src.core.llm import get_llm
from src.core.logging import get_logger
from src.core.sync_db import get_sync_db
from src.core.vectorstore import get_collections
from src.models.repo import Repo

logger = get_logger(__name__)


# Files a human reader would look at first. Ordered by "signal-per-KB":
# high-signal small files first.
TOUR_PRIORITY = (
    "README.md", "README.rst", "README.txt", "README",
    "package.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
    "docker-compose.yaml", "docker-compose.yml", "Dockerfile",
    "src/main.py", "backend/main.py", "app.py", "server.py",
    "src/index.ts", "src/index.js", "app/layout.tsx",
    "CONTRIBUTING.md", "ARCHITECTURE.md", "DESIGN.md",
)


SYSTEM_PROMPT = """You are writing a "how to read this codebase" tour for a developer who has never seen it.

Given a small set of the repo's top-level files (README, package/config manifests, and a handful of entrypoint source files), produce a compact tour.

Sections (in this order, skip any you cannot answer confidently):

## What it does
Two or three sentences of plain English. No marketing tone.

## How to run it
The exact commands you would run locally, based on what the manifests say. If multiple are possible, list the most obvious one first.

## Where to look first
A short bulleted list — 3-6 items — of the files a new reader should open, and one line each on why.

## Notable dependencies
Two or three lines noting the significant frameworks / libraries the manifests declare, and what they're used for here.

## Watch-outs
Anything unusual that would trip a new contributor up (custom build step, required env vars, non-standard directory layout, generated files, etc.). Skip this section if nothing stands out.

Keep the whole tour under 500 words. Cite file paths inline as `path/like/this.py`. Do not invent files or capabilities; if the sources don't show it, don't claim it. No preamble, no sign-off."""


def _pick_files_from_disk(clone_root: Path) -> list[tuple[str, str]]:
    """Return [(rel_path, content)] for the highest-signal files on disk."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for rel in TOUR_PRIORITY:
        p = clone_root / rel
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # Cap individual file at ~8KB — the tour prompt only needs a look,
        # not the whole thing.
        out.append((rel, text[:8_000]))
        seen.add(rel)
        if len(out) >= 10:
            break
    return out


def _pick_files_from_chunks(collection_name: str) -> list[tuple[str, str]]:
    """Fallback when the clone is gone: reconstruct top-level file text
    from indexed chunks. Ordered the same way as _pick_files_from_disk."""
    try:
        collection = get_collections(collection_name)
    except Exception as exc:
        logger.warning(f"[tour] chroma unavailable: {exc}")
        return []
    out: list[tuple[str, str]] = []
    for rel in TOUR_PRIORITY:
        try:
            data = collection.get(
                where={"path": rel},
                include=["documents", "metadatas"],
                limit=20,
            )
        except Exception:
            continue
        docs = data.get("documents") or []
        metas = data.get("metadatas") or []
        if not docs:
            continue
        # Stitch chunks in start_line order, cap total.
        rows = sorted(
            zip(docs, metas),
            key=lambda t: int((t[1] or {}).get("start_line") or 0),
        )
        text = "\n".join(d for d, _ in rows)
        out.append((rel, text[:8_000]))
        if len(out) >= 10:
            break
    return out


def _render_prompt(pairs: list[tuple[str, str]]) -> str:
    parts = []
    for rel, text in pairs:
        parts.append(f"----- {rel} -----\n{text}")
    return "\n\n".join(parts)


@celery_app.task(bind=True, name="generate_repo_tour_task", max_retries=1, default_retry_delay=30)
def generate_repo_tour_task(self, repo_id: str) -> dict:
    db = get_sync_db()
    try:
        repo: Optional[Repo] = db.get(Repo, repo_id)
        if repo is None:
            logger.warning(f"[tour] repo {repo_id} vanished")
            return {"status": "not_found"}
        collection_name = repo.collection_name
        owner_name = f"{repo.owner}/{repo.name}"
    finally:
        db.close()

    clone_root = Path(settings.REPO_CLONE_DIR) / repo_id
    pairs = _pick_files_from_disk(clone_root) if clone_root.exists() else []
    if not pairs:
        pairs = _pick_files_from_chunks(collection_name)
    if not pairs:
        logger.info(f"[tour] repo={repo_id} no source files to tour")
        return {"status": "skipped", "reason": "no source"}

    llm = get_llm(task="generate_complex", temperature=0.15, pipeline="code")
    prompt = f"Repo: {owner_name}\n\n{_render_prompt(pairs)}"
    try:
        response = llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        tour = (response.content or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"[tour] llm failed for repo={repo_id}: {exc}")
        raise self.retry(exc=exc)

    if not tour:
        return {"status": "empty"}

    db = get_sync_db()
    try:
        repo = db.get(Repo, repo_id)
        if repo is None:
            return {"status": "not_found"}
        repo.tour_markdown = tour
        repo.tour_generated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()

    logger.info(f"[tour] repo={repo_id} tour generated ({len(tour)} chars)")
    return {"status": "ok", "chars": len(tour)}

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)


_GITHUB_URL_RE = re.compile(
    r"^(?:https?://github\.com/|git@github\.com:)(?P<owner>[^/]+)/(?P<name>[^/]+?)(?:\.git)?/?$"
)


@dataclass(frozen=True)
class GitHubRepoRef:
    owner: str
    name: str
    clone_url: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"


def parse_github_url(url: str) -> GitHubRepoRef:
    url = url.strip()
    m = _GITHUB_URL_RE.match(url)
    if not m:
        raise ValueError(f"Not a recognizable GitHub URL: {url}")

    owner = m.group("owner")
    name = m.group("name")
    clone_url = f"https://github.com/{owner}/{name}.git"

    return GitHubRepoRef(owner=owner, name=name, clone_url=clone_url)


def _authed_clone_url(clone_url: str, token: Optional[str]) -> str:
    if not token:
        return clone_url
    parts = urlparse(clone_url)
    return f"{parts.scheme}://x-access-token:{token}@{parts.netloc}{parts.path}"


class RepoCloneError(RuntimeError):
    pass


def clone_repo(ref: GitHubRepoRef, dest: Path, token: Optional[str] = None, depth: int = 1):
    if dest.exists():
        raise RepoCloneError(f"Clone destination already exists: {dest}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    url = _authed_clone_url(ref.clone_url, token)

    logger.info(f"[github] cloning {ref.full_name} → {dest} (depth={depth})")

    try:
        subprocess.run(
            ["git", "clone", "--depth", str(depth), "--single-branch", url, str(dest)],
            check=True,
            capture_output=True,
            timeout=settings.REPO_CLONE_TIMEOUT_SECONDS
        )

    except subprocess.TimeoutExpired as exc:
        raise RepoCloneError(f"Clone timed out after {settings.REPO_CLONE_TIMEOUT_SECONDS}s") from exc
    
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode(errors="replace")
        if token:
            stderr = stderr.replace(token, "***")
        raise RepoCloneError(f"git clone failed: {stderr.strip()[:500]}") from None

    head_sha = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return head_sha


def remove_clone(dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)


@dataclass
class FileEntry:
    path: Path           
    rel_path: str         
    size: int
    language: Optional[str]


LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".go": "go", ".java": "java", ".rs": "rust",
    ".rb": "ruby", ".php": "php", ".c": "c", ".h": "c",
    ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp",
    ".cs": "csharp", ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
    ".md": "markdown", ".rst": "rst", ".txt": "text",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".sh": "bash", ".sql": "sql",
}


def walk_repo(root: Path) -> list[FileEntry]:
    ignored_dirs = settings.repo_ignored_dirs
    ignored_suffixes = settings.repo_ignored_suffixes
    indexable = settings.repo_indexable_extensions
    max_file_bytes = settings.REPO_MAX_FILE_SIZE_MB * 1024 * 1024

    entries: list[FileEntry] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue

        if any(part in ignored_dirs for part in p.relative_to(root).parts):
            continue

        name_lower = p.name.lower()

        if any(name_lower.endswith(s) for s in ignored_suffixes):
            continue

        ext = p.suffix.lower()
        if ext not in indexable:
            continue
        try:
            size = p.stat().st_size
        except OSError:
            continue
        if size == 0 or size > max_file_bytes:
            continue

        entries.append(FileEntry(
            path=p,
            rel_path=str(p.relative_to(root)).replace("\\", "/"),
            size=size,
            language=LANG_BY_EXT.get(ext),
        ))
    return entries


def diff_paths(clone_path: Path, from_sha: str, to_sha: str) -> tuple[list[str], list[str]]:
    """Return (changed_paths, removed_paths) between two SHAs.

    Requires a non-shallow clone OR that both SHAs are reachable. If the
    shallow clone doesn't have from_sha, fall back to fetching with
    --unshallow before calling this.
    """
    result = subprocess.run(
        ["git", "-C", str(clone_path), "diff", "--name-status", f"{from_sha}..{to_sha}"],
        check=True, capture_output=True, text=True,
    )
    changed, removed = [], []
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 2: continue
        status, path = parts[0], parts[-1]
        if status.startswith("D"):
            removed.append(path)
        else:
            changed.append(path)
    return changed, removed


def unshallow(clone_path: Path) -> None:
    subprocess.run(
        ["git", "-C", str(clone_path), "fetch", "--unshallow"],
        check=False, capture_output=True,
    )
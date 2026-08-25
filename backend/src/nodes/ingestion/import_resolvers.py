"""Reads project configs (tsconfig, package.json workspaces, pyproject,
setup.cfg) to learn path aliases and package roots, then uses that when
resolving imports."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class ResolverContext:
    all_paths: set[str]
    ts_base_url: str = ""                       # relative to repo root
    ts_paths: dict[str, list[str]] = field(default_factory=dict)   # "@app/*" -> ["src/app/*"]
    py_source_roots: list[str] = field(default_factory=list)       # e.g. ["src", "backend/src"]


def build_context(clone_root: Path, all_paths: set[str]) -> ResolverContext:
    ctx = ResolverContext(all_paths=all_paths)
    _load_tsconfig(clone_root, ctx)
    _load_python_roots(clone_root, ctx)
    return ctx


def _load_tsconfig(root: Path, ctx: ResolverContext) -> None:
    for name in ("tsconfig.json", "jsconfig.json"):
        p = root / name
        if not p.exists():
            continue
        try:
            data = json.loads(_strip_jsonc(p.read_text(encoding="utf-8")))
        except Exception as exc:
            logger.warning(f"[resolvers] failed to parse {name}: {exc}")
            continue
        opts = data.get("compilerOptions", {})
        ctx.ts_base_url = (opts.get("baseUrl") or "").strip("./")
        ctx.ts_paths = opts.get("paths", {}) or {}
        break


def _load_python_roots(root: Path, ctx: ResolverContext) -> None:
    # pyproject: tool.setuptools.package-dir or tool.poetry.packages
    py = root / "pyproject.toml"
    if py.exists():
        try:
            import tomllib
            data = tomllib.loads(py.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        setup_dir = (data.get("tool", {}).get("setuptools", {})
                          .get("package-dir", {}) or {})
        for v in setup_dir.values():
            if v and v not in ctx.py_source_roots:
                ctx.py_source_roots.append(v.strip("/"))
        poetry_pkgs = (data.get("tool", {}).get("poetry", {}).get("packages", []) or [])
        for pkg in poetry_pkgs:
            frm = pkg.get("from")
            if frm and frm not in ctx.py_source_roots:
                ctx.py_source_roots.append(frm.strip("/"))

    # Common convention: if repo has a src/ dir with __init__.py-less packages
    if "src" in {p.split("/", 1)[0] for p in ctx.all_paths} and "src" not in ctx.py_source_roots:
        ctx.py_source_roots.append("src")


def _strip_jsonc(text: str) -> str:
    # tsconfig allows // and /* */ comments; strip cheaply
    import re
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    # trailing commas
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return text


# --- resolution -------------------------------------------------------------

def resolve_python(module: str, ctx: ResolverContext) -> Optional[str]:
    """Try each configured source root as a prefix before falling back to
    root-relative lookup."""
    if not module:
        return None
    parts = module.split(".")
    roots = ["", *ctx.py_source_roots]     # "" = repo root
    for root in roots:
        for i in range(len(parts), 0, -1):
            rel = "/".join(parts[:i])
            prefix = f"{root}/{rel}" if root else rel
            for cand in (f"{prefix}.py", f"{prefix}/__init__.py"):
                if cand in ctx.all_paths:
                    return cand
    return None


def resolve_js(specifier: str, from_file: str, ctx: ResolverContext) -> Optional[str]:
    # Relative? Delegate to lexical resolver.
    if specifier.startswith("."):
        return _lexical_js(specifier, from_file, ctx.all_paths)

    # tsconfig paths mapping
    for pattern, targets in ctx.ts_paths.items():
        if pattern.endswith("/*"):
            prefix = pattern[:-2]
            if specifier.startswith(prefix + "/"):
                tail = specifier[len(prefix) + 1:]
                for tgt in targets:
                    base = tgt[:-2] if tgt.endswith("/*") else tgt
                    root = f"{ctx.ts_base_url}/{base}" if ctx.ts_base_url else base
                    resolved = _try_extensions(f"{root}/{tail}".lstrip("/"), ctx.all_paths)
                    if resolved:
                        return resolved
        elif pattern == specifier:
            for tgt in targets:
                root = f"{ctx.ts_base_url}/{tgt}" if ctx.ts_base_url else tgt
                resolved = _try_extensions(root.lstrip("/"), ctx.all_paths)
                if resolved:
                    return resolved

    # baseUrl alone (no paths): try `<baseUrl>/<specifier>`
    if ctx.ts_base_url:
        return _try_extensions(f"{ctx.ts_base_url}/{specifier}", ctx.all_paths)
    return None


def _lexical_js(specifier: str, from_file: str, all_paths: set[str]) -> Optional[str]:
    parts = from_file.split("/")[:-1]
    for seg in specifier.split("/"):
        if seg in (".", ""): continue
        if seg == "..":
            if parts: parts.pop()
        else:
            parts.append(seg)
    return _try_extensions("/".join(parts), all_paths)


def _try_extensions(base: str, all_paths: set[str]) -> Optional[str]:
    for suffix in ("", ".ts", ".tsx", ".js", ".jsx",
                   "/index.ts", "/index.tsx", "/index.js", "/index.jsx"):
        cand = base + suffix
        if cand in all_paths:
            return cand
    return None
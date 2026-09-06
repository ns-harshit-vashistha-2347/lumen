"""One-shot loader for the Lumen bench.

Uploads every document under ../docs/ into your Lumen library, creates
an eval suite scoped to those docs, and adds the questions from
../suites/doc-rag.jsonl. Optionally starts a run at the end.

The code suite works the same way but doesn't upload anything — you're
expected to connect the ../code/tiny-todo directory as a repo in the
code playground first (or point at any other repo whose files line up
with the questions), then supply its repo_id via --repo-id.

Usage
-----
    export LUMEN_API=http://localhost:8080
    export LUMEN_TOKEN=<access-token-from-DevTools-or-/auth/login>
    python load_bench.py --doc-suite
    python load_bench.py --code-suite --repo-id <uuid>
    python load_bench.py --doc-suite --run   # upload + create + immediately run

You can get LUMEN_TOKEN from browser DevTools → Application → Local
Storage → lumen:access_token, or by POSTing to /auth/login.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOCS_DIR = ROOT / "docs"
SUITES_DIR = ROOT / "suites"


def _client() -> httpx.Client:
    api = os.environ.get("LUMEN_API")
    token = os.environ.get("LUMEN_TOKEN")
    if not api or not token:
        sys.exit(
            "LUMEN_API and LUMEN_TOKEN env vars are required.\n"
            "  export LUMEN_API=http://localhost:8080\n"
            "  export LUMEN_TOKEN=<access token>"
        )
    return httpx.Client(
        base_url=api.rstrip("/"),
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0,
    )


def _log(msg: str) -> None:
    print(f"[bench] {msg}", flush=True)


def _upload_docs(client: httpx.Client) -> list[str]:
    """Upload every .md in DOCS_DIR. Returns the created document_ids."""
    doc_ids: list[str] = []
    files = sorted(DOCS_DIR.glob("*.md"))
    if not files:
        sys.exit(f"No documents found under {DOCS_DIR}")
    for path in files:
        _log(f"uploading {path.name}")
        with open(path, "rb") as fh:
            resp = client.post(
                "/documents/upload",
                files={"file": (path.name, fh, "text/markdown")},
            )
        if resp.status_code >= 300:
            sys.exit(f"upload failed for {path.name}: {resp.status_code} {resp.text}")
        doc_id = resp.json()["document_id"]
        doc_ids.append(doc_id)
    return doc_ids


def _wait_for_ingest(client: httpx.Client, doc_ids: list[str], timeout_s: int = 600) -> None:
    """Poll /documents/{id} until every doc is COMPLETED or FAILED."""
    deadline = time.time() + timeout_s
    pending = set(doc_ids)
    while pending and time.time() < deadline:
        for doc_id in list(pending):
            r = client.get(f"/documents/{doc_id}")
            if r.status_code != 200:
                continue
            status = r.json().get("status")
            if status == "completed":
                pending.discard(doc_id)
                _log(f"ingested {doc_id[:8]}")
            elif status == "failed":
                sys.exit(f"ingest failed for {doc_id}: {r.json().get('error_message')}")
        if pending:
            time.sleep(3)
    if pending:
        sys.exit(f"timed out waiting for {len(pending)} docs to ingest")


def _create_doc_suite(client: httpx.Client, doc_ids: list[str]) -> str:
    resp = client.post("/evals/suites", json={
        "name": "Lumen doc-RAG bench",
        "description": "Self-contained doc-RAG regression suite (Acme fixtures).",
        "document_ids": doc_ids,
    })
    if resp.status_code >= 300:
        sys.exit(f"suite create failed: {resp.status_code} {resp.text}")
    suite_id = resp.json()["id"]
    _log(f"created doc suite {suite_id}")
    return suite_id


def _create_code_suite(client: httpx.Client) -> str:
    resp = client.post("/evals/suites", json={
        "name": "Lumen code-RAG bench (tiny-todo)",
        "description": (
            "Self-contained code-RAG regression suite. Connect the "
            "datasets/lumen-bench/code/tiny-todo folder as a repo first."
        ),
    })
    if resp.status_code >= 300:
        sys.exit(f"suite create failed: {resp.status_code} {resp.text}")
    suite_id = resp.json()["id"]
    _log(f"created code suite {suite_id}")
    return suite_id


def _add_cases(client: httpx.Client, suite_id: str, jsonl_path: Path) -> int:
    n = 0
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        case = json.loads(line)
        payload = {"question": case["question"], "expected": case["expected"]}
        r = client.post(f"/evals/suites/{suite_id}/cases", json=payload)
        if r.status_code >= 300:
            _log(f"case add failed: {r.status_code} {r.text}")
            continue
        n += 1
    _log(f"added {n} cases to {suite_id}")
    return n


def _run_suite(client: httpx.Client, suite_id: str) -> None:
    r = client.post(f"/evals/suites/{suite_id}/run")
    if r.status_code >= 300:
        sys.exit(f"run start failed: {r.status_code} {r.text}")
    run_id = r.json()["id"]
    _log(f"started run {run_id} — open /evals in the UI to watch it")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc-suite", action="store_true", help="Upload docs + create doc-RAG suite")
    ap.add_argument("--code-suite", action="store_true", help="Create code-RAG suite (repo must already be connected)")
    ap.add_argument("--repo-id", type=str, default=None,
                    help="Repo UUID for the code suite (informational; the code suite is not doc-scoped)")
    ap.add_argument("--run", action="store_true", help="Trigger a run right after creating the suite")
    ap.add_argument("--skip-upload", action="store_true",
                    help="Skip uploading docs (use when docs are already in the library — pass --doc-ids)")
    ap.add_argument("--doc-ids", type=str, default=None,
                    help="Comma-separated document ids to scope the doc suite to (when --skip-upload)")
    args = ap.parse_args()

    if not (args.doc_suite or args.code_suite):
        ap.error("pick at least one of --doc-suite / --code-suite")

    with _client() as client:
        if args.doc_suite:
            if args.skip_upload:
                if not args.doc_ids:
                    sys.exit("--skip-upload requires --doc-ids")
                doc_ids = [x.strip() for x in args.doc_ids.split(",") if x.strip()]
            else:
                doc_ids = _upload_docs(client)
                _wait_for_ingest(client, doc_ids)
            suite_id = _create_doc_suite(client, doc_ids)
            _add_cases(client, suite_id, SUITES_DIR / "doc-rag.jsonl")
            if args.run:
                _run_suite(client, suite_id)

        if args.code_suite:
            if not args.repo_id:
                _log("note: --repo-id not passed; make sure the tiny-todo repo is connected before running the suite")
            suite_id = _create_code_suite(client)
            _add_cases(client, suite_id, SUITES_DIR / "code-rag.jsonl")
            if args.run:
                _run_suite(client, suite_id)


if __name__ == "__main__":
    main()

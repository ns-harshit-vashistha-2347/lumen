# Lumen Bench

A self-contained regression suite for Lumen's doc-RAG and code-RAG
pipelines. Every question in this bench maps to real content shipped
inside this folder — no external downloads, no HuggingFace pulls.

```
datasets/lumen-bench/
├── docs/                    5 realistic markdown documents
├── code/tiny-todo/          A tiny FastAPI + SQLite app (~300 LOC)
├── suites/
│   ├── doc-rag.jsonl        30 doc-RAG cases (factual, multi-hop,
│   │                        unanswerable, tabular, adversarial)
│   └── code-rag.jsonl       20 code-RAG cases (symbol, behavior,
│                            dependency, boundary, unanswerable)
├── scripts/load_bench.py    One-command loader that uploads to Lumen
└── README.md                you are here
```

## What's in each doc

| File | What it tests |
|---|---|
| `acme-data-retention-policy.md` | Policy doc with a table + explicit "not covered" section → factual lookup, tabular queries, unanswerable questions |
| `acme-api-reference.md` | REST API reference with an error-code table and rate-limit rules → tabular + boundary questions |
| `q3-outage-postmortem.md` | Incident report with timeline + action-item table → multi-hop across sections, date arithmetic |
| `research-attention-retention.md` | Fake research paper → summarisation, "what did the paper NOT do" questions, faithfulness under adversarial pressure |
| `onboarding-guide.md` | Checklist-style prose → procedural questions, "can I do X?" boundaries |

## What's in each code file

`tiny-todo/` is deliberately small so you can hand-verify every answer:

- `main.py` — FastAPI routes + Pydantic schemas
- `models.py` — SQLAlchemy models (User, Todo)
- `auth.py` — bcrypt + PyJWT auth
- `db.py` — engine + session dependency
- `settings.py` — env-driven config

The code cases cover: symbol lookup, behaviour tracing, dependencies,
authorisation boundaries, and honest-refusal on features that don't
exist (rate limiting, calendar sync).

## Case shape

Each line of `suites/*.jsonl` is:

```json
{
  "kind": "factual | multihop | tabular | boundary | unanswerable | adversarial | symbol | behavior | dependency",
  "doc":  "acme-data-retention-policy.md",           // doc suites only
  "file": "auth.py",                                 // code suites only
  "question": "How long does Acme retain financial ledger entries?",
  "expected": "7 years, driven by SOX §802. Must reference the retention table (§3) or cite SOX."
}
```

The `expected` field is written for the **judge LLM**. It can be a
concrete answer, a set of criteria ("must mention X, must not
mention Y"), or a mix. Your eval harness's judge prompt already
handles both shapes.

## Load into Lumen — the doc suite

Prereqs:
- Lumen is running (`docker compose up` or however you run it).
- You have an access token. Log in through the UI, then in DevTools:
  Application → Local Storage → `lumen:access_token` — copy that.

```bash
export LUMEN_API=http://localhost:8080
export LUMEN_TOKEN=<paste your token>

cd datasets/lumen-bench/scripts
python load_bench.py --doc-suite --run
```

That uploads all 5 documents, waits for ingestion, creates the eval
suite scoped to those docs, adds the 30 cases, and kicks off a run.
Open `/evals` in the UI to watch the pass/partial/fail bar fill up.

## Load into Lumen — the code suite

The code suite doesn't upload anything for you — Lumen's code-RAG
pipeline works against a git repo, so:

1. Push `datasets/lumen-bench/code/tiny-todo/` to a new GitHub repo
   (public is easiest). Or use any private repo you have if you'd
   rather test the token path.
2. In the UI, go to **code** → connect that repo → wait for ingest.
3. Copy the repo's UUID from its URL (`/code-playground/<uuid>`).
4. Run:
   ```bash
   python load_bench.py --code-suite --repo-id <uuid> --run
   ```
   (The `--repo-id` is informational; the code suite isn't
   doc-scoped in the current schema. The generated suite will query
   your whole repo library — that's fine as long as tiny-todo is the
   only connected repo when the run fires.)

## What "good" looks like

Rough targets after your first run. Nothing to panic about below
these; they're just orientation.

| Metric | Doc suite | Code suite |
|---|---|---|
| Pass rate | ≥ 70% | ≥ 60% |
| Adversarial pass | 100% (all should refuse / stay grounded) | 100% |
| Unanswerable pass | ≥ 80% (model should say "the doc doesn't say") | ≥ 80% |
| Judge "error" verdicts | 0 (any errors point at pipeline bugs) | 0 |
| P95 latency per case | < 12s | < 15s |

## Re-run the same suite after any change

The whole point of the bench is regression detection. Every time you:

- swap an embedder / reranker,
- change `RETRIEVAL_TOP_K` or `RERANK_CANDIDATE_POOL`,
- edit a prompt,
- flip a provider policy,

click **run** on the suite again and diff the pass counts. A drop of
more than 2-3 points is a real signal.

## Extending the bench

- **More cases**: add JSONL lines. Keep `kind` consistent so you can
  slice pass-rate by shape later (e.g. "we regressed on multihop but
  factual is fine").
- **Your own domain**: swap `docs/` for your real docs and rewrite the
  questions. Use RAGAS (see the earlier assistant reply) to
  auto-generate an initial 50-question suite from any doc set.
- **Public bench comparison**: pull HotpotQA / SQuAD 2 / CodeRAG-Bench
  and load a subset via a similar script — pattern is the same.

## Files at a glance (word counts)

```
acme-data-retention-policy.md   ~ 550 words
acme-api-reference.md           ~ 500 words
q3-outage-postmortem.md         ~ 500 words
research-attention-retention.md ~ 550 words
onboarding-guide.md             ~ 400 words
tiny-todo/                      ~ 300 LOC across 6 files
```

Total bench size on disk is well under 200 KB.

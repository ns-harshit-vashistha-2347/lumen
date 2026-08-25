# Lumen v2.0 — Plan

## Goals
Add codebase understanding to Lumen. Users connect a GitHub repo, and get RAG + a knowledge graph over the code, queryable from a new "Code Playground" section. Route model calls across multiple providers to spread cost and rate limits.

## Scope
1. Codebase RAG (GitHub-only ingestion, public + private via token)
2. Code knowledge graph (symbols, imports, call edges)
3. Multi-provider LLM routing (Groq + Gemini, extensible)
4. New "Code Playground" section (parallel to Chat and Library)

Out of scope for v2.0: non-GitHub sources (GitLab, Bitbucket, zip upload), auto re-index on push (manual refresh only), IDE plugins.

---

## Repo Limits
| Tier | Repo size | Files | Notes |
|---|---|---|---|
| Free | 100 MB | 10k | Covers ~85% of GitHub |
| Pro | 500 MB | 50k | v2.0 default cap |
| Enterprise | 2 GB+ | unlimited | Later — needs incremental indexing |

- Per-file cap: 1 MB (skip minified/generated).
- Filter before indexing: `node_modules`, `dist`, `build`, `.git`, lockfiles, binaries, images, vendored deps.
- Pre-index preview shown to user: file count, estimated chunks, estimated time. No silent rejection at cap.

---

## Architecture Additions

### Backend
```
backend/src/
  core/
    llm_router.py        NEW — provider selection + rate-limit tracking
    providers/           NEW — groq.py, gemini.py, base.py
    github_client.py     NEW — clone, auth via user token
  nodes/
    ingestion/
      code_parse.py      NEW — tree-sitter AST-aware chunking
      code_embed.py      NEW — reuses embed.py where possible
      graph_build.py     NEW — symbol + import + call-edge extraction
    retrieval/
      code_dense.py      NEW — code-specific dense retriever
      graph_query.py     NEW — graph traversal for symbol/dep questions
  graphs/
    code_ingestion_graph.py   NEW
    code_query_graph.py       NEW
  routes/
    repos.py             NEW — connect/list/refresh/delete repo
    code_query.py        NEW — Code Playground queries
  models/
    repo.py              NEW — Repo, RepoFile, RepoSymbol tables
  tasks/
    code_ingestion_tasks.py   NEW — Celery: clone → parse → embed → graph
```

### Frontend
```
frontend/app/
  code-playground/       NEW — repo list, connect flow, chat UI per repo
  code-playground/[repoId]/  NEW — per-repo session
components/
  repo-connector/        NEW — GitHub OAuth + token entry
  graph-viewer/          NEW — optional symbol graph visualization
```

---

## Data Flow — Repo Ingestion
1. User connects GitHub repo (OAuth for public, PAT for private).
2. Backend clones to temp dir, runs filter, returns preview to user.
3. On confirm → Celery job:
   - AST parse (tree-sitter, per language)
   - Chunk at symbol boundaries (function/class), not fixed size
   - Embed chunks → vector store (namespace per repo)
   - Extract graph: nodes = symbols/files/modules; edges = imports, calls, inheritance
   - Store graph (Postgres tables initially; Neo4j later if needed)
4. Delete temp clone. Persist only chunks + graph.

## Data Flow — Code Query
1. User asks question in Code Playground.
2. Classify: symbol-lookup / dependency / behavior / general.
3. Route:
   - Symbol/dep → graph query first, dense retrieval second
   - Behavior/general → dense + BM25 + rerank (reuse existing retrieval nodes)
4. LLM Router picks provider based on task (see below).
5. Generate answer, stream to client.

---

## LLM Router
Single `LLMRouter` class. All model calls go through it.

Policy per task:
| Task | Preferred | Fallback |
|---|---|---|
| Embedding | Gemini `text-embedding-004` (free tier generous) | Groq |
| Cheap chat / classify / rewrite | Groq Llama 3.1 8B | Gemini Flash |
| Heavy reasoning / final answer | Gemini 2.0 Flash / Pro | Groq Llama 3.3 70B |
| Rerank | Groq (fast) | Gemini Flash |

Router tracks per-provider RPM/TPM. On 429 → mark provider cool-down, fail over automatically.

---

## Milestones

**M1 — Provider routing (1 week)**
- Add `LLMRouter` + Gemini provider
- Migrate existing calls in `nodes/retrieval/*` to router
- No user-visible change

**M2 — GitHub ingestion (1–2 weeks)**
- `repos` table + routes
- GitHub client (clone + auth)
- Filter + preview endpoint
- Celery clone → parse → embed pipeline
- AST chunking for top 5 languages (Py, JS/TS, Go, Java, Rust)

**M3 — Code graph (1 week)**
- Symbol/import/call extraction
- Store in Postgres (nodes + edges tables)
- Graph query node

**M4 — Code Playground UI (1 week)**
- Connect-repo flow
- Per-repo chat page
- Optional graph viewer

**M5 — Polish (few days)**
- Pre-index preview UX
- Rate-limit indicator when router falls back
- Delete/refresh repo

Total: ~5 weeks realistic.

---

## Open Decisions
- Graph store: Postgres tables vs. Neo4j? → **Start Postgres**, move only if graph queries get complex.
- Vector store namespacing: per-repo collection vs. shared with metadata filter? → **Per-repo collection**, cleaner deletes.
- Private-repo tokens: encrypted at rest with per-user key. Never log. Short-lived clone only.
- Cost cap per user per month? → decide before Pro tier launch.

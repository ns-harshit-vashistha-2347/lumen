"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Github,
  Plus,
  RefreshCw,
  Trash2,
  X as XIcon,
  Loader2,
  ArrowRight,
  Lock,
  Globe,
  Cpu,
  Database,
  Radio,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { reposApi, type Repo, type RepoPreview, type RepoStatus } from "@/lib/rag";

const ACTIVE: Set<RepoStatus> = new Set([
  "pending",
  "cloning",
  "parsing",
  "embedding",
  "storing",
  "graph_building",
]);

const STATUS_STYLES: Record<RepoStatus, string> = {
  pending: "text-warn border-warn/40 bg-warn/5",
  cloning: "text-prompt border-prompt/40 bg-prompt/5",
  parsing: "text-prompt border-prompt/40 bg-prompt/5",
  embedding: "text-prompt border-prompt/40 bg-prompt/5",
  storing: "text-prompt border-prompt/40 bg-prompt/5",
  graph_building: "text-prompt border-prompt/40 bg-prompt/5",
  completed: "text-ok border-ok/40 bg-ok/5",
  failed: "text-danger border-danger/40 bg-danger/5",
};

const STATUS_LABELS: Record<RepoStatus, string> = {
  pending: "PENDING",
  cloning: "CLONE",
  parsing: "PARSE",
  embedding: "EMBED",
  storing: "STORE",
  graph_building: "GRAPH",
  completed: "READY",
  failed: "FAILED",
};

function RepoStatusBadge({ status }: { status: RepoStatus }) {
  const active = ACTIVE.has(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-[3px] font-mono text-[10px] font-semibold tracking-[0.14em]",
        STATUS_STYLES[status]
      )}
    >
      {active && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function CodePlaygroundInner() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await reposApi.list();
      setRepos(data);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.detail);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is in-flight
  useEffect(() => {
    const anyActive = repos.some((r) => ACTIVE.has(r.status));
    if (!anyActive) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [repos, load]);

  async function handleRefresh(id: string) {
    try {
      await reposApi.refresh(id);
      toast.success("re-index queued");
      load();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.detail);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("delete this repo and all its indexed data?")) return;
    try {
      await reposApi.del(id);
      setRepos((rs) => rs.filter((r) => r.id !== id));
      toast.success("deleted");
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.detail);
    }
  }

  return (
    <div className="relative flex h-[calc(100vh-2.75rem)] flex-col warp-ambient">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-scanline opacity-40 mix-blend-overlay"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 warp-grid opacity-[0.35]"
      />

      {/* toolbar */}
      <div className="relative z-10 border-b border-chrome-border bg-chrome/60 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-[11.5px] tracking-tight text-ink-dim">
            <Github className="h-3.5 w-3.5 text-mk-yellow" />
            <span className="text-ink">connected repos</span>
            <span className="text-ink-faint">·</span>
            <span className="text-mk-green glow-text">{repos.length}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setConnectOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-chrome-border bg-gradient-to-b from-prompt to-prompt-soft px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow transition hover:brightness-110"
          >
            <Plus className="h-3 w-3" />
            connect repo
          </button>
        </div>
        <SystemHud repos={repos} />
      </div>

      {/* body */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6">
          {loading ? (
            <div className="flex items-center gap-2 font-mono text-xs text-ink-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              loading…
            </div>
          ) : repos.length === 0 ? (
            <EmptyRepoState onConnect={() => setConnectOpen(true)} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {repos.map((r) => (
                <RepoCard
                  key={r.id}
                  repo={r}
                  onRefresh={() => handleRefresh(r.id)}
                  onDelete={() => handleDelete(r.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {connectOpen && (
        <ConnectRepoDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(r) => {
            setRepos((rs) => [r, ...rs]);
            setConnectOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RepoCard({
  repo,
  onRefresh,
  onDelete,
}: {
  repo: Repo;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const ready = repo.status === "completed";
  const failed = repo.status === "failed";
  const active = ACTIVE.has(repo.status);
  return (
    <li
      className={cn(
        "hex-frame group relative flex flex-col gap-3 overflow-hidden rounded-md border border-chrome-border bg-bg-soft/80 p-3 shadow-block transition hover:border-prompt/40",
        active && "border-prompt/30"
      )}
    >
      <span className="hex-corner" />
      {active && <span className="scan-sweep-x" aria-hidden />}

      {/* short id line — helps repo feel like a container */}
      <div className="pointer-events-none absolute right-2 top-2 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint/70">
        <span className={cn("led mr-1 align-middle", ready ? "text-ok" : active ? "text-warn" : failed ? "text-danger" : "text-ink-faint")} />
        <span>{repo.id.slice(0, 6)}</span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
            {repo.is_private ? (
              <Lock className="h-3 w-3 text-mk-yellow" />
            ) : (
              <Globe className="h-3 w-3 text-mk-blue" />
            )}
            <span>{repo.provider}</span>
            <span className="text-ink-faint">·</span>
            <span>{repo.default_branch}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[13px] text-ink">
            <span className="text-ink-dim">{repo.owner}/</span>
            <span className="text-mk-pink glow-prompt">{repo.name}</span>
          </p>
        </div>
        <RepoStatusBadge status={repo.status} />
      </div>

      {active && <IngestProgressBar status={repo.status} />}

      <div className="grid grid-cols-3 gap-2 rounded border border-chrome-border/60 bg-bg/60 p-2 font-mono text-[10.5px] text-ink-dim">
        <Stat label="files" value={repo.total_files || repo.indexed_files} />
        <Stat label="chunks" value={repo.total_chunks} />
        <Stat
          label="size"
          value={
            repo.size_bytes
              ? `${(repo.size_bytes / 1024 / 1024).toFixed(1)}m`
              : "—"
          }
        />
      </div>

      {failed && repo.error_message && (
        <p className="rounded border border-danger/40 bg-danger/5 px-2 py-1 font-mono text-[10.5px] text-danger">
          {repo.error_message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Link
          href={`/code-playground/${repo.id}`}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] transition",
            ready
              ? "border-prompt/40 text-prompt hover:bg-prompt/10"
              : "cursor-not-allowed border-chrome-border/50 text-ink-faint"
          )}
          aria-disabled={!ready}
          onClick={(e) => {
            if (!ready) e.preventDefault();
          }}
        >
          open playground
          <ArrowRight className="h-3 w-3" />
        </Link>
        <button
          onClick={onRefresh}
          disabled={active}
          title="re-index"
          className="inline-flex items-center gap-1 rounded border border-chrome-border px-2 py-1.5 font-mono text-[10.5px] text-ink-dim hover:border-mk-yellow/40 hover:text-mk-yellow disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", active && "animate-spin")} />
        </button>
        <button
          onClick={onDelete}
          title="delete"
          className="inline-flex items-center gap-1 rounded border border-chrome-border px-2 py-1.5 font-mono text-[10.5px] text-ink-dim hover:border-danger/40 hover:text-danger"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
      <span className="truncate text-ink">{value ?? "—"}</span>
    </div>
  );
}

function EmptyRepoState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="animate-slide-up crt-flicker overflow-hidden rounded-md border border-chrome-border bg-bg-soft/80 shadow-block">
      <div className="flex items-center justify-between border-b border-chrome-border px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-dim">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-danger/70" />
            <span className="h-2 w-2 rounded-full bg-warn/70" />
            <span className="h-2 w-2 rounded-full bg-ok/70" />
          </span>
          <span className="text-prompt">◆</span> lumen · code-playground · tty1
        </span>
        <span className="flex items-center gap-1.5 text-ink-faint normal-case tracking-normal">
          <span className="led text-warn" />
          <span className="text-warn">no repos linked</span>
        </span>
      </div>
      <div className="px-4 py-5 font-mono text-[12.5px] leading-relaxed text-ink">
        <pre className="overflow-x-auto font-mono text-[11px] leading-[1.05] text-prompt glow-prompt">
{String.raw`  ______   ______   _____   ______
 / ____/  / __  /  / __  \ / ____/
/ /      / / / /  / / / // __/
/ /___  / /_/ /  / /_/ // /___
\____/  \____/  /_____//_____/    // v2.0`}
        </pre>

        <BootLog />

        <p className="mt-4 text-ink-dim">
          <span className="text-prompt">▸</span> point lumen at a github repo to
          index its <span className="text-mk-blue">symbols</span>, <span className="text-mk-yellow">imports</span>, and
          <span className="text-mk-purple"> call graph</span>.
        </p>
        <p className="mt-1 text-ink-faint">
          public repos need no token; private repos accept a fine-grained PAT
          (read-only, scoped to that repo).
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={onConnect}
            className="inline-flex items-center gap-2 rounded-md border border-chrome-border bg-gradient-to-b from-prompt to-prompt-soft px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow hover:brightness-110"
          >
            <Plus className="h-3 w-3" />
            connect first repo
          </button>
          <span className="font-mono text-[10.5px] text-ink-faint">
            or press <kbd className="rounded border border-chrome-border bg-bg px-1 text-[9.5px] text-mk-yellow">⌘K</kbd> → “open code playground”
          </span>
        </div>
      </div>

      <ActivityTicker />
    </div>
  );
}

function BootLog() {
  const LINES: React.ReactNode[] = [
    <>
      kernel <span className="text-ink">code-graph-2.0</span> loaded
    </>,
    <>
      embedder <span className="text-mk-blue">bge-large-en-v1.5</span> · dims 1024
    </>,
    <>
      graph store <span className="text-mk-green">kuzu</span> · rel:{" "}
      <span className="text-ink">DEFINES · IMPORTS · CALLS · INHERITS</span>
    </>,
    <>
      llm router <span className="text-mk-yellow">groq</span> → <span className="text-mk-purple">gemini</span> failover
    </>,
    <>ingest pipeline armed · awaiting target</>,
  ];
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setN((v) => (v >= LINES.length ? v : v + 1)),
      220
    );
    return () => clearInterval(id);
  }, [LINES.length]);
  return (
    <div className="mt-4 space-y-0.5">
      {LINES.slice(0, n).map((line, i) => (
        <p key={i} className="text-ink-dim">
          <span className="text-mk-green">▸</span>{" "}
          <span className="text-ink-faint">[ok]</span> {line}
        </p>
      ))}
      {n < LINES.length && (
        <p className="text-ink-faint">
          <span className="text-prompt">▸</span> booting
          <span className="caret text-prompt" />
        </p>
      )}
    </div>
  );
}

function ActivityTicker() {
  const items = [
    "TREE-SITTER py+ts+go+java+rust",
    "SYMBOLS extracted",
    "IMPORTS resolved via tsconfig+pyproject",
    "CALLS graph indexed",
    "MMR + BGE-RERANK gated",
    "KUZU cypher: MATCH (:File)-[:IMPORTS]->(:File)",
    "STREAMING /code-query/stream",
  ];
  const text = items.join("   ///   ");
  return (
    <div className="relative overflow-hidden border-t border-chrome-border/50 bg-bg/40 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-mk-comment">
      <div className="marquee">
        <span>{text}   ///   </span>
        <span>{text}   ///   </span>
      </div>
    </div>
  );
}

function SystemHud({ repos }: { repos: Repo[] }) {
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(
      () => setUptime(Math.floor((performance.now() - t0) / 1000)),
      500
    );
    return () => clearInterval(id);
  }, []);
  const up = `${String(Math.floor(uptime / 60)).padStart(2, "0")}:${String(
    uptime % 60
  ).padStart(2, "0")}`;
  const ready = repos.filter((r) => r.status === "completed").length;
  const active = repos.filter((r) => ACTIVE.has(r.status)).length;
  const chunks = repos.reduce((s, r) => s + (r.total_chunks || 0), 0);
  const files = repos.reduce((s, r) => s + (r.indexed_files || r.total_files || 0), 0);

  return (
    <div className="mx-auto mt-2 flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 border-t border-chrome-border/50 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
      <HudStat icon={<Radio className="h-3 w-3" />} label="link" value="ok" tone="ok" />
      <HudStat icon={<Database className="h-3 w-3" />} label="kuzu" value="online" tone="ok" />
      <HudStat icon={<Cpu className="h-3 w-3" />} label="providers" value="groq/gemini" tone="mk-blue" />
      <HudStat icon={<Terminal className="h-3 w-3" />} label="ready" value={ready} tone="ok" />
      <HudStat label="active" value={active} tone={active ? "warn" : "ink-dim"} />
      <HudStat label="chunks" value={chunks.toLocaleString()} tone="mk-yellow" />
      <HudStat label="files" value={files.toLocaleString()} tone="mk-purple" />
      <div className="flex-1" />
      <span>
        up <span className="text-mk-green">{up}</span>
      </span>
    </div>
  );
}

function HudStat({
  icon,
  label,
  value,
  tone = "ink",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  tone?: string;
}) {
  const cls =
    tone === "ok" ? "text-ok"
      : tone === "warn" ? "text-warn"
      : tone === "mk-blue" ? "text-mk-blue"
      : tone === "mk-yellow" ? "text-mk-yellow"
      : tone === "mk-purple" ? "text-mk-purple"
      : tone === "ink-dim" ? "text-ink-dim"
      : "text-ink";
  return (
    <span className="flex items-center gap-1.5">
      {icon && <span className={cls}>{icon}</span>}
      <span>{label}</span>
      <span className={cn(cls, "tick")}>{value}</span>
    </span>
  );
}

function IngestProgressBar({ status }: { status: RepoStatus }) {
  const order: RepoStatus[] = [
    "pending",
    "cloning",
    "parsing",
    "embedding",
    "storing",
    "graph_building",
    "completed",
  ];
  const idx = order.indexOf(status);
  const pct = Math.max(6, Math.round(((idx + 1) / order.length) * 100));
  return (
    <div className="relative overflow-hidden rounded border border-chrome-border/60 bg-bg/60">
      <div className="flex items-center justify-between px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
        <span>
          stage <span className="text-prompt">{STATUS_LABELS[status]}</span>
        </span>
        <span className="text-ink">{pct}%</span>
      </div>
      <div className="h-1.5 w-full bg-bg-raised">
        <div
          className="progress-stripes h-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---- connect dialog -------------------------------------------------------

function ConnectRepoDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (r: Repo) => void;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("");
  const [preview, setPreview] = useState<RepoPreview | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "confirming" | "connecting">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function runPreview() {
    if (!url.trim()) return;
    setPhase("previewing");
    setPreview(null);
    try {
      const p = await reposApi.preview(url.trim(), token.trim() || undefined);
      setPreview(p);
      setPhase("confirming");
    } catch (err) {
      setPhase("idle");
      const msg = err instanceof ApiError ? err.detail : "preview failed";
      toast.error(msg);
    }
  }

  async function runConnect() {
    setPhase("connecting");
    try {
      const r = await reposApi.connect(
        url.trim(),
        token.trim() || undefined,
        branch.trim() || undefined
      );
      toast.success(`${r.owner}/${r.name} queued`);
      onConnected(r);
    } catch (err) {
      setPhase("confirming");
      const msg = err instanceof ApiError ? err.detail : "connect failed";
      toast.error(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-16 backdrop-blur-sm">
      <div className="relative w-full max-w-lg animate-slide-up overflow-hidden rounded-md border border-chrome-border bg-bg-soft shadow-block hex-frame">
        <span className="hex-corner" />
        {phase === "previewing" && (
          <span className="scan-sweep" aria-hidden />
        )}
        <div className="flex items-center justify-between border-b border-chrome-border px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-dim">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-danger/70" />
              <span className="h-2 w-2 rounded-full bg-warn/70" />
              <span className="h-2 w-2 rounded-full bg-ok/70" />
            </span>
            <span className="text-prompt">◆</span> connect · github repo
          </span>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-ink"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 font-mono text-[12px] text-ink">
          <label className="block">
            <span className="mb-1 block text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">
              repo url
            </span>
            <input
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/vercel/next.js"
              disabled={phase === "connecting" || phase === "previewing"}
              className="w-full rounded border border-chrome-border bg-bg-raised px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-prompt/50 focus:outline-none focus:shadow-prompt"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">
              access token <span className="text-ink-faint">(optional · private repos)</span>
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_… or ghp_…"
              autoComplete="off"
              disabled={phase === "connecting" || phase === "previewing"}
              className="w-full rounded border border-chrome-border bg-bg-raised px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-prompt/50 focus:outline-none focus:shadow-prompt"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">
              branch <span className="text-ink-faint">(default: main)</span>
            </span>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              disabled={phase === "connecting" || phase === "previewing"}
              className="w-full rounded border border-chrome-border bg-bg-raised px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-prompt/50 focus:outline-none focus:shadow-prompt"
            />
          </label>

          {preview && (
            <div
              className={cn(
                "rounded border px-3 py-2 font-mono text-[11px]",
                preview.would_reject
                  ? "border-danger/40 bg-danger/5 text-danger"
                  : "border-ok/40 bg-ok/5 text-ok"
              )}
            >
              <p className="text-ink">
                <span className="text-ink-dim">{preview.owner}/</span>
                <span className="text-mk-pink">{preview.name}</span>
              </p>
              <p className="mt-1 text-ink-dim">
                <span className="text-ink">{preview.estimated_files}</span> indexable files
                {" · "}
                <span className="text-ink">{preview.estimated_size_mb.toFixed(1)} MB</span>
              </p>
              {preview.would_reject ? (
                <p className="mt-1">
                  <span className="text-danger">rejected:</span> {preview.reject_reason}
                </p>
              ) : (
                <p className="mt-1 text-ok">within limits · safe to index</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-chrome-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-chrome-border px-2.5 py-1.5 font-mono text-[10.5px] text-ink-dim hover:text-ink"
          >
            cancel
          </button>
          {phase !== "confirming" ? (
            <button
              onClick={runPreview}
              disabled={!url.trim() || phase === "previewing"}
              className="inline-flex items-center gap-1.5 rounded border border-chrome-border bg-chrome-hover px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-ink hover:border-prompt/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "previewing" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  scanning
                </>
              ) : (
                <>preview</>
              )}
            </button>
          ) : (
            <button
              onClick={runConnect}
              disabled={preview?.would_reject || phase === "connecting"}
              className="inline-flex items-center gap-1.5 rounded bg-gradient-to-b from-prompt to-prompt-soft px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow hover:brightness-110 disabled:cursor-not-allowed disabled:from-prompt/30 disabled:to-prompt-soft/30 disabled:shadow-none"
            >
              {phase === "connecting" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  connecting
                </>
              ) : (
                <>
                  connect & index
                  <ArrowRight className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CodePlaygroundPage() {
  return (
    <AuthProvider>
      <AppShell>
        <CodePlaygroundInner />
      </AppShell>
    </AuthProvider>
  );
}

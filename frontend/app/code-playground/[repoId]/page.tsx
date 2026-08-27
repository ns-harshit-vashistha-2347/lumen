"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  FileCode,
  GitBranch,
  Sigma,
  Network,
  Copy,
  Check,
  Radio,
  Cpu,
  Database,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { GraphButton, GraphVisualizer } from "@/components/graph-visualizer";
import { SessionSidebar, SidebarToggle } from "@/components/session-sidebar";
import { ApiError } from "@/lib/api";
import { chatSessionsApi } from "@/lib/chat-history";
import { cn } from "@/lib/cn";
import {
  reposApi,
  type CodeSourceChunk,
  type GraphHit,
  type Repo,
  type SourceChunk,
} from "@/lib/rag";
import { postStream } from "@/lib/stream";
import { AnswerBody } from "@/components/chat/answer-body";
import { SkeletonSources } from "@/components/chat/skeleton-sources";

const SAMPLES = [
  "where is the auth middleware defined?",
  "who calls the ingest_repo_task function?",
  "explain how retrieval fusion works",
  "what does src/app.py import?",
];


type CodeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  streaming?: boolean;
  error?: boolean;
  intent?: string;
  graph_hits?: GraphHit[];
  sources?: CodeSourceChunk[];
  streamingSources?: {
    path?: string | null;
    start_line?: number | null;
    end_line?: number | null;
    symbol_name?: string | null;
  }[];
  at: Date;
};

function CodeChatInner() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const router = useRouter();

  const [repo, setRepo] = useState<Repo | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(true);
  const [messages, setMessages] = useState<CodeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeLoadRef = useRef<string | null>(null);
  const loadSession = useCallback(async (id: string | null) => {
    activeLoadRef.current = id;
    setSessionId(id);
    if (!id) {
      setMessages([]);
      setLastTraceId(null);
      return;
    }
    try {
      const msgs = await chatSessionsApi.messages(id);
      if (activeLoadRef.current !== id) return;
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          at: new Date(m.created_at),
          intent: (m.payload?.intent as string) || undefined,
          graph_hits: (m.payload?.graph_hits as GraphHit[]) || undefined,
          sources: (m.payload?.sources as CodeSourceChunk[]) || undefined,
        }))
      );
      const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
      setLastTraceId(lastAsst?.trace_id || null);
    } catch (err) {
      if (activeLoadRef.current !== id) return;
      if (err instanceof ApiError) toast.error(err.detail);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await reposApi.get(repoId);
        setRepo(r);
      } catch (err) {
        if (err instanceof ApiError) toast.error(err.detail);
        router.replace("/code-playground");
      } finally {
        setLoadingRepo(false);
      }
    })();
  }, [repoId, router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (!text || sending) return;
    if (!repo || repo.status !== "completed") {
      toast.error("repo not ready");
      return;
    }

    const userMsg: CodeMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      at: new Date(),
    };
    const loadingId = crypto.randomUUID();
    const loadingMsg: CodeMessage = {
      id: loadingId,
      role: "assistant",
      content: "",
      loading: true,
      streaming: true,
      at: new Date(),
    };
    setMessages((m) => [...m, userMsg, loadingMsg]);
    setInput("");
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    await postStream(
      "/code-query/stream",
      {
        repo_id: repoId,
        query: text,
        session_id: sessionId || undefined,
        persist: true,
      },
      {
        signal: controller.signal,
        onMeta: (meta) => {
          const sid = meta.session_id as string | null | undefined;
          const tid = meta.trace_id as string | null | undefined;
          const intent = (meta.intent as string) || undefined;
          const graph_hits = (meta.graph_hits as GraphHit[]) || undefined;
          const sources = (meta.sources as CodeMessage["streamingSources"]) || undefined;
          if (sid && !sessionId) setSessionId(sid);
          if (tid) setLastTraceId(tid);
          setMessages((m) =>
            m.map((msg) =>
              msg.id === loadingId
                ? {
                    ...msg,
                    loading: false,
                    intent,
                    graph_hits,
                    streamingSources: sources,
                  }
                : msg
            )
          );
        },
        onToken: (chunk) => {
          acc += chunk;
          setMessages((m) =>
            m.map((msg) =>
              msg.id === loadingId ? { ...msg, loading: false, content: acc } : msg
            )
          );
        },
        onDone: () => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === loadingId
                ? {
                    ...msg,
                    streaming: false,
                    loading: false,
                    content: acc || "_(no answer generated)_",
                  }
                : msg
            )
          );
          setSending(false);
        },
        onError: (err) => {
          const detail = err instanceof ApiError ? err.detail : err.message || "something went wrong";
          setMessages((m) =>
            m.map((msg) =>
              msg.id === loadingId
                ? {
                    ...msg,
                    streaming: false,
                    loading: false,
                    error: true,
                    content: `_error: ${detail}_`,
                  }
                : msg
            )
          );
          toast.error(detail);
          setSending(false);
        },
      }
    );
  }

  if (loadingRepo) {
    return (
      <div className="flex h-[calc(100vh-2.75rem)] items-center justify-center">
        <span className="flex items-center gap-2 font-mono text-xs text-ink-dim">
          <Loader2 className="h-3 w-3 animate-spin" />
          loading repo…
        </span>
      </div>
    );
  }
  if (!repo) return null;

  const notReady = repo.status !== "completed";

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

      {/* header */}
      <div className="relative z-10 border-b border-chrome-border bg-chrome/60 px-4 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link
            href="/code-playground"
            className="inline-flex items-center gap-1 rounded border border-chrome-border px-2 py-1 font-mono text-[10.5px] text-ink-dim hover:border-prompt/40 hover:text-ink"
          >
            <ArrowLeft className="h-3 w-3" />
            repos
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
              <GitBranch className="h-3 w-3 text-mk-blue" />
              <span>{repo.default_branch}</span>
              {repo.last_indexed_sha && (
                <>
                  <span>·</span>
                  <span className="text-mk-yellow">
                    {repo.last_indexed_sha.slice(0, 7)}
                  </span>
                </>
              )}
            </div>
            <p className="truncate font-mono text-[13px]">
              <span className="text-ink-dim">{repo.owner}/</span>
              <span className="text-mk-pink">{repo.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>
              chunks <span className="text-ink">{repo.total_chunks}</span>
            </span>
            <span className="hidden sm:inline">
              files <span className="text-ink">{repo.indexed_files || repo.total_files}</span>
            </span>
            <SidebarToggle onClick={() => setSidebarOpen(true)} />
            <GraphButton onClick={() => setGraphOpen(true)} />
          </div>
        </div>
      </div>

      <SessionSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        kind="code"
        repoId={repoId}
        currentSessionId={sessionId}
        onSelect={(id) => {
          setSidebarOpen(false);
          loadSession(id);
        }}
      />

      <GraphVisualizer
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        graphName="code_query"
        traceId={lastTraceId}
        title={`${repo.owner}/${repo.name}`}
      />

      {/* messages */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
          {notReady && <NotReadyBanner status={repo.status} />}
          {messages.length === 0 ? (
            <CodeEmpty
              onPick={(p) => submit(p)}
              disabled={notReady}
              repo={repo}
            />
          ) : (
            messages.map((m) => <CodeBubble key={m.id} message={m} />)
          )}
        </div>
      </div>

      {/* input */}
      <div className="relative z-10 border-t border-chrome-border bg-chrome/70 backdrop-blur-xl">
        <div className="relative mx-auto max-w-4xl px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className={cn(
              "group relative flex items-end gap-2 overflow-hidden rounded-md border border-chrome-border bg-bg-raised px-3 py-2 focus-within:border-prompt/50 focus-within:shadow-prompt",
              sending && "border-prompt/40"
            )}
          >
            {sending && <span className="scan-sweep-x" aria-hidden />}
            <span className="mt-[7px] shrink-0 font-mono text-[13px] font-semibold text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.55)]">
              ▸
            </span>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                notReady
                  ? "waiting for indexing…"
                  : `ask across ${repo.owner}/${repo.name}…`
              }
              rows={1}
              disabled={sending || notReady}
              className="min-h-[24px] flex-1 resize-none bg-transparent py-1 font-mono text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending || notReady}
              className="mt-0.5 shrink-0 rounded bg-gradient-to-b from-prompt to-prompt-soft px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-prompt/30 disabled:to-prompt-soft/30 disabled:text-[#1a0410]/40 disabled:shadow-none"
              aria-label="send"
            >
              {sending ? "…" : "SEND ↵"}
            </button>
          </form>
        </div>
        <RepoStatusStrip
          repo={repo}
          sending={sending}
          msgCount={messages.length}
        />
      </div>
    </div>
  );
}

function RepoStatusStrip({
  repo,
  sending,
  msgCount,
}: {
  repo: Repo;
  sending: boolean;
  msgCount: number;
}) {
  const [now, setNow] = useState<string>("");
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => {
      setNow(new Date().toLocaleTimeString([], { hour12: false }));
      setUptime(Math.floor((performance.now() - t0) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, []);
  const up = `${String(Math.floor(uptime / 60)).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-chrome-border/60 bg-bg-soft/40 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5">
          <Radio className="h-3 w-3 text-ok" />
          <span className={sending ? "text-warn tick" : "text-ok"}>
            {sending ? "querying" : "link ok"}
          </span>
        </span>
        <span className="hidden sm:inline">
          <Database className="mr-1 inline h-3 w-3 text-mk-green" />
          kuzu <span className="text-ink">on</span>
        </span>
        <span className="hidden sm:inline">
          <Cpu className="mr-1 inline h-3 w-3 text-mk-blue" />
          route <span className="text-mk-blue">groq/gemini</span>
        </span>
        <span>
          repo <span className="text-mk-pink">{repo.owner}/{repo.name}</span>
        </span>
        <span className="hidden md:inline">
          chunks <span className="text-ink">{repo.total_chunks.toLocaleString()}</span>
        </span>
        <span className="hidden md:inline">
          msgs <span className="text-ink">{msgCount}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">shift+↵ newline</span>
        <span>up <span className="text-mk-green">{up}</span></span>
        <span className="text-ink">{now}</span>
      </div>
    </div>
  );
}

function NotReadyBanner({ status }: { status: Repo["status"] }) {
  const active = status !== "failed";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 font-mono text-[11.5px]",
        active
          ? "border-warn/40 bg-warn/5 text-warn"
          : "border-danger/40 bg-danger/5 text-danger"
      )}
    >
      {active ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-danger shadow-[0_0_6px_currentColor]" />
      )}
      <span>
        {active
          ? `repo is ${status.replace("_", " ")}… queries will unlock when indexing completes.`
          : "indexing failed. head back to the repo list to retry."}
      </span>
    </div>
  );
}

function CodeEmpty({
  onPick,
  disabled,
  repo,
}: {
  onPick: (p: string) => void;
  disabled: boolean;
  repo: Repo;
}) {
  return (
    <div className="crt-flicker animate-slide-up overflow-hidden rounded-md border border-chrome-border bg-bg-soft/80 shadow-block hex-frame">
      <span className="hex-corner" />
      <div className="flex items-center justify-between border-b border-chrome-border px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-dim">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-danger/70" />
            <span className="h-2 w-2 rounded-full bg-warn/70" />
            <span className="h-2 w-2 rounded-full bg-ok/70" />
          </span>
          <span className="text-prompt">◆</span> lumen · code-playground · pty0
        </span>
        <span className="flex items-center gap-1.5 text-ink-faint normal-case tracking-normal">
          <span className="led text-ok" />
          <span className="text-ok">indexed</span>
        </span>
      </div>

      <pre className="overflow-x-auto px-4 pt-4 font-mono text-[11px] leading-[1.05] text-prompt glow-prompt">
{String.raw`  ______   ______   _____   ______
 / ____/  / __  /  / __  \ / ____/
/ /      / / / /  / / / // __/
/ /___  / /_/ /  / /_/ // /___
\____/  \____/  /_____//_____/`}
      </pre>

      <div className="px-4 pb-1 pt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
        code-graph shell · repo{" "}
        <span className="text-mk-pink">
          {repo.owner}/{repo.name}
        </span>
      </div>

      <div className="px-4 py-4 font-mono text-[12.5px] leading-relaxed text-ink">
        <CodeBootLog repo={repo} />

        <p className="mt-4 text-ink">
          <span className="text-prompt">▸</span> ask, or launch a preset:
        </p>

        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {SAMPLES.map((s, i) => (
            <button
              key={s}
              disabled={disabled}
              onClick={() => onPick(s)}
              className="group flex items-start gap-2 rounded border border-chrome-border bg-bg-raised/60 px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-ink-muted transition-all hover:border-prompt/40 hover:bg-prompt/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="mt-[3px] rounded border border-chrome-border/70 px-1 text-[9.5px] text-mk-purple opacity-90 group-hover:opacity-100">
                [{i + 1}]
              </span>
              <span>{s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodeBootLog({ repo }: { repo: Repo }) {
  const LINES: React.ReactNode[] = [
    <>
      target <span className="text-mk-pink">{repo.owner}/{repo.name}</span> ·
      branch <span className="text-mk-blue">{repo.default_branch}</span>
      {repo.last_indexed_sha && (
        <>
          {" "}
          @ <span className="text-mk-yellow">{repo.last_indexed_sha.slice(0, 7)}</span>
        </>
      )}
    </>,
    <>
      corpus <span className="text-ink">{repo.total_chunks.toLocaleString()}</span> chunks
      / <span className="text-ink">{(repo.indexed_files || repo.total_files).toLocaleString()}</span> files
    </>,
    <>
      graph <span className="text-mk-green">kuzu.ready</span> · schema{" "}
      <span className="text-ink">Symbol,File,Module + CALLS/IMPORTS/DEFINES</span>
    </>,
    <>
      classifier <span className="text-mk-purple">symbol / dependency / behavior / general</span>
    </>,
    <>session <span className="text-ok">ready</span> · awaiting query</>,
  ];
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setN((v) => (v >= LINES.length ? v : v + 1)),
      200
    );
    return () => clearInterval(id);
  }, [LINES.length]);
  return (
    <div className="space-y-0.5">
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

// ------- assistant / user bubble ------------------------------------------

function CodeBubble({ message }: { message: CodeMessage }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  }

  const bubbleSources: SourceChunk[] | undefined = message.sources?.map((s) => ({
    content: s.content,
    metadata: {
      source: s.path,
      path: s.path,
      symbol_name: s.symbol_name,
      symbol_kind: s.symbol_kind,
      start_line: s.start_line,
      end_line: s.end_line,
    } as Record<string, unknown>,
    score: s.score,
  }));

  return (
    <article
      className={cn(
        "overflow-hidden rounded-md border animate-fade-in",
        isUser
          ? "border-prompt/30 bg-prompt/[0.06]"
          : "border-chrome-border bg-bg-soft/70",
        message.error && "border-danger/40 bg-danger/[0.05]"
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-3 border-b px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em]",
          isUser
            ? "border-prompt/25 text-prompt"
            : message.error
            ? "border-danger/30 text-danger"
            : "border-chrome-border text-ink-dim"
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn(isUser ? "text-prompt" : message.error ? "text-danger" : "text-ok")}>
            {isUser ? "▸" : message.error ? "×" : "◆"}
          </span>
          <span className="font-semibold">{isUser ? "you" : "lumen"}</span>
          {!isUser && (message.streaming || message.loading) && (
            <span className="flex items-center gap-1.5 normal-case tracking-normal text-prompt">
              <span className="h-1.5 w-1.5 rounded-full bg-prompt animate-pulse shadow-[0_0_6px_currentColor]" />
              {message.streaming ? "streaming" : "proc"}
            </span>
          )}
          {!isUser && !message.streaming && !message.loading && message.intent && (
            <IntentPill intent={message.intent} />
          )}
        </span>
        {!isUser && !message.loading && !message.streaming && message.content && (
          <button
            onClick={copyContent}
            className="rounded p-1 text-ink-faint hover:bg-chrome-hover hover:text-ink"
            aria-label="copy"
          >
            {copied ? (
              <Check className="h-3 w-3 text-ok" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
      </header>

      <div className="px-3.5 py-3">
        {message.loading && !message.content ? (
          <p className="font-mono text-[12px] text-ink-dim">
            <span className="text-prompt">▸</span> retrieving from graph +
            vectors<span className="caret text-prompt" />
          </p>
        ) : isUser ? (
          <p className="whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-ink">
            {message.content}
          </p>
        ) : (
          <AnswerBody
            content={message.content || (message.streaming ? "" : "_(no answer)_")}
            sources={bubbleSources}
            streaming={message.streaming}
          />
        )}

        {!isUser && message.streaming && !message.sources && message.streamingSources && (
          <SkeletonSources hints={message.streamingSources} />
        )}
        {!isUser && !message.streaming && !message.loading && !!message.graph_hits?.length && (
          <GraphHitsBlock hits={message.graph_hits} />
        )}
        {!isUser && !message.streaming && !message.loading && !!message.sources?.length && (
          <SourcesBlock sources={message.sources} />
        )}
      </div>
    </article>
  );
}

function IntentPill({ intent }: { intent: string }) {
  const map: Record<string, { icon: React.ReactNode; cls: string }> = {
    symbol: { icon: <Sigma className="h-3 w-3" />, cls: "text-mk-blue border-mk-blue/40" },
    dependency: { icon: <Network className="h-3 w-3" />, cls: "text-mk-purple border-mk-purple/40" },
    behavior: { icon: <FileCode className="h-3 w-3" />, cls: "text-mk-green border-mk-green/40" },
    general: { icon: <FileCode className="h-3 w-3" />, cls: "text-ink-dim border-chrome-border" },
  };
  const meta = map[intent] || map.general;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[9.5px] tracking-[0.14em] normal-case",
        meta.cls
      )}
    >
      {meta.icon}
      {intent}
    </span>
  );
}

function GraphHitsBlock({ hits }: { hits: GraphHit[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded border border-chrome-border/60 bg-bg/60">
      <div className="flex items-center gap-2 border-b border-chrome-border/60 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
        <Network className="h-3 w-3 text-mk-purple" />
        <span>graph hits</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink">{hits.length}</span>
      </div>
      <ul className="divide-y divide-chrome-border/40">
        {hits.slice(0, 12).map((h, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 font-mono text-[11.5px]">
            <span
              className={cn(
                "rounded border px-1.5 py-[1px] text-[9.5px] uppercase tracking-[0.14em]",
                h.kind === "symbol" && "text-mk-blue border-mk-blue/40",
                h.kind === "caller" && "text-mk-yellow border-mk-yellow/40",
                h.kind === "callee" && "text-mk-purple border-mk-purple/40"
              )}
            >
              {h.kind}
            </span>
            {h.symbol && <span className="text-mk-pink">{h.symbol}</span>}
            {h.symbol_kind && (
              <span className="text-[10px] text-ink-faint">({h.symbol_kind})</span>
            )}
            <span className="text-ink-dim">{h.path}</span>
            {h.start_line && (
              <span className="text-ink-faint">
                :{h.start_line}
                {h.end_line && h.end_line !== h.start_line && `-${h.end_line}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesBlock({ sources }: { sources: CodeSourceChunk[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-3 overflow-hidden rounded border border-chrome-border/60 bg-bg/60">
      <div className="flex items-center gap-2 border-b border-chrome-border/60 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
        <FileCode className="h-3 w-3 text-mk-blue" />
        <span>sources</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink">{sources.length}</span>
      </div>
      <ul className="divide-y divide-chrome-border/40">
        {sources.map((s, i) => {
          const isOpen = open === i;
          return (
            <li key={i} className="font-mono text-[11.5px]">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left hover:bg-chrome-hover/40"
              >
                <span className="text-mk-green">[{i + 1}]</span>
                {s.symbol_name && (
                  <span className="text-mk-pink">{s.symbol_name}</span>
                )}
                {s.symbol_kind && (
                  <span className="text-[10px] text-ink-faint">({s.symbol_kind})</span>
                )}
                <span className="text-ink-dim">{s.path}</span>
                {s.start_line && (
                  <span className="text-ink-faint">
                    :{s.start_line}
                    {s.end_line && s.end_line !== s.start_line && `-${s.end_line}`}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-ink-faint">
                  score {s.score.toFixed(2)}
                </span>
              </button>
              {isOpen && (
                <pre className="max-h-72 overflow-auto border-t border-chrome-border/40 bg-bg px-3 py-2 text-[11.5px] leading-relaxed text-ink">
                  {s.content}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function CodePlaygroundChatPage() {
  return (
    <AuthProvider>
      <AppShell>
        <CodeChatInner />
      </AppShell>
    </AuthProvider>
  );
}

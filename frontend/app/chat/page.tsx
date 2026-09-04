"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MessageBubble, type ChatMessage } from "@/components/chat/message";
import { ScopeBar } from "@/components/chat/scope-bar";
import { GraphButton, GraphVisualizer } from "@/components/graph-visualizer";
import { SessionSidebar, SidebarToggle } from "@/components/session-sidebar";
import { MatrixRain } from "@/components/matrix-rain";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useScope } from "@/lib/scope-store";
import { chatSessionsApi } from "@/lib/chat-history";
import { postStream } from "@/lib/stream";

const SAMPLES = [
  "summarize the key points across every document in scope",
  "what are the main risks mentioned?",
  "list every deadline referenced with its date",
  "compare the recommendations in my two most recent uploads",
];

const SLASH: { cmd: string; desc: string }[] = [
  { cmd: "/help", desc: "show all commands" },
  { cmd: "/clear", desc: "wipe this conversation" },
  { cmd: "/scope", desc: "open library to select documents" },
  { cmd: "/summarize", desc: "summarise every doc in scope" },
];

function ChatInner() {
  const [scope] = useScope();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
      // If the user switched to a different session mid-flight, drop this
      // response — the newer selection wins.
      if (activeLoadRef.current !== id) return;
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          at: new Date(m.created_at),
          sources: (m.payload?.sources as ChatMessage["sources"]) || undefined,
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

  function pushSystem(content: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      at: new Date(),
    };
    setMessages((m) => [...m, msg]);
  }

  function handleSlash(text: string): boolean {
    if (!text.startsWith("/")) return false;
    const [cmd, ...rest] = text.split(/\s+/);
    if (cmd === "/help") {
      pushSystem(
        "**available commands**\n\n" +
          SLASH.map((s) => `- \`${s.cmd}\` — ${s.desc}`).join("\n")
      );
      setInput("");
      return true;
    }
    if (cmd === "/clear") {
      setMessages([]);
      setSessionId(null);
      setLastTraceId(null);
      setInput("");
      return true;
    }
    if (cmd === "/scope") {
      router.push("/documents");
      setInput("");
      return true;
    }
    if (cmd === "/summarize") {
      setInput("");
      submit("summarise every document currently in scope and highlight the key themes");
      return true;
    }
    void rest;
    // Any other slash-prefixed input is an unknown command — swallow it so
    // the user doesn't accidentally send "/foo" as a real query.
    pushSystem(`unknown command: \`${cmd}\` · try \`/help\``);
    setInput("");
    return true;
  }

  const abortRef = useRef<AbortController | null>(null);

  // Ref pattern: `submit` closes over `scope`, `sessionId`, `sending`, etc.
  // and would be a new reference every render, defeating MessageBubble's
  // React.memo. `submitRef.current` stays fresh; the exported `submit`
  // below is stable.
  async function submitImpl(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (!text || sending) return;
    if (handleSlash(text)) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      at: new Date(),
      scopeCount: scope.size,
    };
    const loadingId = crypto.randomUUID();
    const loadingMsg: ChatMessage = {
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
      "/query/stream",
      {
        query: text,
        top_k: 5,
        document_ids: scope.size > 0 ? [...scope] : undefined,
        session_id: sessionId || undefined,
        persist: true,
      },
      {
        signal: controller.signal,
        onMeta: (meta) => {
          const sid = meta.session_id as string | null | undefined;
          const tid = meta.trace_id as string | null | undefined;
          const sources = meta.sources as ChatMessage["streamingSources"] | undefined;
          if (sid && !sessionId) setSessionId(sid);
          if (tid) setLastTraceId(tid);
          setMessages((m) =>
            m.map((msg) =>
              msg.id === loadingId
                ? { ...msg, loading: false, streamingSources: sources || undefined }
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const submitRef = useRef(submitImpl);
  useEffect(() => { submitRef.current = submitImpl; });
  const submit = useCallback((p?: string) => submitRef.current(p), []);

  // Stable refs so memoized MessageBubble doesn't re-render every message
  // on every keystroke / token. Both callbacks read from state via the
  // current-value refs below, so they don't need messages in deps.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const onRetry = useCallback((assistantMsg: ChatMessage) => {
    const msgs = messagesRef.current;
    const idx = msgs.findIndex((m) => m.id === assistantMsg.id);
    let user: ChatMessage | null = null;
    for (let i = idx - 1; i >= 0; i--)
      if (msgs[i].role === "user") { user = msgs[i]; break; }
    if (!user) return;
    setMessages((m) => m.filter((x) => x.id !== assistantMsg.id));
    submit(user.content);
  }, []);

  const onEditResend = useCallback((userMsg: ChatMessage, newContent: string) => {
    setMessages((m) => {
      const idx = m.findIndex((x) => x.id === userMsg.id);
      return idx >= 0 ? m.slice(0, idx) : m;
    });
    submit(newContent);
  }, []);

  return (
    <div className="relative flex h-[calc(100vh-2.75rem)] flex-col warp-ambient">
      {/* matrix rain — very faint */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <MatrixRain opacity={0.14} speed={0.6} />
      </div>
      {/* subtle scanline overlay for that CRT feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-scanline opacity-50 mix-blend-overlay"
      />
      {/* hacker grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 hacker-grid opacity-40"
      />
      {/* moving scan line */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="scan-line" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 crt-vignette" />

      {/* scope bar */}
      <div className="relative z-10 border-b border-chrome-border bg-chrome/60 px-4 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="flex-1">
            <ScopeBar />
          </div>
          <SidebarToggle onClick={() => setSidebarOpen(true)} />
          <GraphButton onClick={() => setGraphOpen(true)} />
        </div>
      </div>

      <SessionSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        kind="doc"
        currentSessionId={sessionId}
        onSelect={(id) => {
          setSidebarOpen(false);
          loadSession(id);
        }}
      />

      <GraphVisualizer
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        graphName="query"
        traceId={lastTraceId}
        title="doc chat"
      />

      {/* messages */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState onPick={(p) => submit(p)} scopeSize={scope.size} />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onRetry={onRetry}
                onEditResend={onEditResend}
              />
            ))
          )}
        </div>
      </div>

      {/* input */}
      <div className="relative z-10 border-t border-chrome-border bg-chrome/70 backdrop-blur-xl">
        <div className="relative mx-auto max-w-3xl px-4 py-3">
          <SlashHint input={input} onPick={(c) => { setInput(""); submit(c); }} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="group flex items-end gap-2 rounded-md border border-chrome-border bg-bg-raised px-3 py-2 focus-within:border-prompt/50 focus-within:shadow-prompt"
          >
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
                scope.size > 0
                  ? `ask across ${scope.size} document${scope.size === 1 ? "" : "s"}…`
                  : "ask across your entire library…"
              }
              rows={1}
              disabled={sending}
              className="min-h-[24px] flex-1 resize-none bg-transparent py-1 font-mono text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="mt-0.5 shrink-0 rounded bg-gradient-to-b from-prompt to-prompt-soft px-2.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-prompt/30 disabled:to-prompt-soft/30 disabled:text-[#1a0410]/40 disabled:shadow-none"
              aria-label="Send"
            >
              {sending ? "…" : "SEND ↵"}
            </button>
          </form>
        </div>
        <StatusStrip scopeSize={scope.size} sending={sending} msgCount={messages.length} />
      </div>
    </div>
  );
}

function SlashHint({
  input,
  onPick,
}: {
  input: string;
  onPick: (cmd: string) => void;
}) {
  if (!input.startsWith("/")) return null;
  const q = input.toLowerCase();
  const matches = SLASH.filter((s) => s.cmd.startsWith(q));
  if (matches.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute bottom-[calc(100%+2px)] left-4 right-4 mb-2 overflow-hidden rounded-md border border-chrome-border bg-bg-soft/95 shadow-block backdrop-blur animate-slide-up">
      <div className="border-b border-chrome-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-mk-comment">
        <span className="text-mk-pink">▸</span> slash commands
      </div>
      <ul>
        {matches.map((s) => (
          <li key={s.cmd}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(s.cmd);
              }}
              className="flex w-full items-center gap-3 px-3 py-1.5 text-left font-mono text-[12px] text-ink-dim hover:bg-line/60 hover:text-ink"
            >
              <span className="text-mk-pink">{s.cmd}</span>
              <span className="text-mk-comment">— {s.desc}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusStrip({
  scopeSize,
  sending,
  msgCount,
}: {
  scopeSize: number;
  sending: boolean;
  msgCount: number;
}) {
  const [now, setNow] = useState<string>("");
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], { hour12: false }));
      setUptime(Math.floor((performance.now() - t0) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, []);
  const up = `${String(Math.floor(uptime / 60)).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-chrome-border/60 bg-bg-soft/40 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className={
              "h-1.5 w-1.5 rounded-full shadow-[0_0_6px_currentColor] " +
              (sending ? "bg-warn text-warn animate-pulse" : "bg-ok text-ok")
            }
          />
          <span className={sending ? "text-warn" : "text-ok"}>
            {sending ? "busy" : "link ok"}
          </span>
        </span>
        <span className="hidden sm:inline">
          scope <span className="text-ink">{scopeSize || "all"}</span>
        </span>
        <span className="hidden sm:inline">
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

function EmptyState({
  onPick,
  scopeSize,
}: {
  onPick: (prompt: string) => void;
  scopeSize: number;
}) {
  return (
    <div className="animate-slide-up relative overflow-hidden rounded-md terminal-frame bracket-frame">
      <span className="bracket-corner" />
      <div className="flex items-center justify-between border-b border-chrome-border bg-chrome/70 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-dim">
        <span className="flex items-center gap-2">
          <span className="text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.7)]">◆</span>
          <span className="neon-text">lumen</span>
          <span className="text-ink-faint">·</span>
          <span>tty0</span>
        </span>
        <span className="flex items-center gap-3 text-ink-faint normal-case tracking-normal">
          <span className="hud-chip"><span className="k">pipe</span><span className="v">rag-v4</span></span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse shadow-[0_0_6px_currentColor]" />
            <span className="text-ok">online</span>
          </span>
        </span>
      </div>

      <pre className="overflow-x-auto px-4 pt-4 font-mono text-[10px] leading-[1.1] text-prompt drop-shadow-[0_0_12px_rgba(249,38,114,0.6)] sm:text-[12px]">
{String.raw`  _     _   _ __  __ _____ _  _
 | |   | | | |  \/  | ____| \| |
 | |   | | | | |\/| |  _| | .  |
 | |___| |_| | |  | | |___| |\  |
 |_____|\___/|_|  |_|_____|_| \_|`}
      </pre>

      <div className="px-4 pb-1 pt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
        <span className="glitch neon-text-green" data-text="retrieval-augmented shell">retrieval-augmented shell</span>
        <span className="mx-2 text-ink-faint">·</span>
        <span className="text-mk-blue">build 0.2.7</span>
        <span className="mx-2 text-ink-faint">·</span>
        <span className="text-mk-yellow">5 llm providers</span>
      </div>

      <div className="px-4 py-4 font-mono text-[12.5px] leading-relaxed text-ink">
        <BootLog scopeSize={scopeSize} />

        <p className="mt-4 text-ink">
          <span className="text-prompt">▸</span> ask anything, or start with a sample:
        </p>

        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {SAMPLES.map((s, i) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="group flex items-start gap-2 rounded border border-chrome-border bg-bg-raised/60 px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-ink-muted transition-all hover:border-prompt/40 hover:bg-prompt/[0.06] hover:text-ink"
            >
              <span className="mt-[3px] text-mk-purple opacity-70 group-hover:opacity-100">
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

function BootLog({ scopeSize }: { scopeSize: number }) {
  const LINES = [
    <>kernel <span className="text-ink">rag-4.0.0</span> loaded</>,
    <>embedder <span className="text-mk-blue">bge-large-en-v1.5</span> · dims 1024</>,
    <>vector store <span className="text-mk-green">connected</span></>,
    <>
      scope ={" "}
      {scopeSize > 0 ? (
        <span className="text-prompt">
          {scopeSize} document{scopeSize === 1 ? "" : "s"}
        </span>
      ) : (
        <>
          <span className="text-warn">unset</span>{" "}
          <Link
            href="/documents"
            className="text-prompt underline underline-offset-4 decoration-prompt/40 hover:text-prompt-glow"
          >
            open library →
          </Link>
        </>
      )}
    </>,
    <>session ready</>,
  ];
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v >= LINES.length ? v : v + 1)), 220);
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
          <span className="text-prompt">▸</span> booting<span className="caret text-prompt" />
        </p>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <AuthProvider>
      <AppShell>
        <ChatInner />
      </AppShell>
    </AuthProvider>
  );
}

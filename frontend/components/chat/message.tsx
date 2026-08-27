"use client";

import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";
import { Sources } from "./sources";

// Custom markdown renderers so wide tables, code blocks, and long lines
// scroll inside the message bubble instead of blowing out its width.
const MD_COMPONENTS: Components = {
  table: ({ children, ...props }) => (
    <div className="my-2 overflow-x-auto rounded border border-chrome-border/60">
      <table className="w-full border-collapse font-mono text-[11.5px]" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th
      className="border-b border-chrome-border/60 bg-bg-raised/60 px-2 py-1 text-left text-ink"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border-b border-chrome-border/40 px-2 py-1 align-top text-ink-dim" {...props}>
      {children}
    </td>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="my-2 max-h-80 overflow-auto rounded border border-chrome-border/60 bg-bg/70 p-2 text-[11.5px] leading-snug"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ inline, className, children, ...props }: {
    inline?: boolean;
    className?: string;
    children?: ReactNode;
  }) =>
    inline ? (
      <code
        className="rounded bg-bg-raised/70 px-1 py-[1px] font-mono text-[12px] text-mk-yellow"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className={cn("font-mono", className)} {...props}>
        {children}
      </code>
    ),
  hr: () => (
    <hr className="my-3 border-0 border-t border-chrome-border/40" />
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-[15px] font-semibold text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] font-semibold text-ink">{children}</h4>,
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  loading?: boolean;
  scopeCount?: number;
  at?: Date;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <article
      className={cn(
        "overflow-hidden rounded-md border animate-fade-in",
        isUser
          ? "border-prompt/30 bg-prompt/[0.06]"
          : "border-chrome-border bg-bg-soft/70"
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-3 border-b px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em]",
          isUser
            ? "border-prompt/25 text-prompt"
            : "border-chrome-border text-ink-dim"
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn(isUser ? "text-prompt" : "text-ok")}>
            {isUser ? "▸" : "◆"}
          </span>
          <span className="font-semibold">
            {isUser ? "you" : "lumen"}
          </span>
          {!isUser && message.loading && (
            <span className="text-prompt normal-case tracking-normal flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-prompt animate-pulse shadow-[0_0_6px_currentColor]" />
              proc
            </span>
          )}
          {!isUser && !message.loading && (
            <span className="text-ok normal-case tracking-normal flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_currentColor]" />
              ok
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-ink-faint">
          {!isUser && !message.loading && message.content && (
            <CopyButton text={message.content} />
          )}
          <span>
            {message.at
              ? message.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
              : ""}
            {isUser && message.scopeCount != null && (
              <span className="ml-3">
                scope <span className="text-prompt">{message.scopeCount || "all"}</span>
              </span>
            )}
          </span>
        </span>
      </header>

      <div className="px-3.5 py-3">
        {isUser ? (
          <p className="whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-ink">
            {message.content}
          </p>
        ) : message.loading ? (
          <LoadingBody />
        ) : (
          <>
            <TypewriterMarkdown content={message.content} id={message.id} />
            {message.sources && message.sources.length > 0 && (
              <Sources sources={message.sources} />
            )}
          </>
        )}
      </div>
    </article>
  );
}

const TRACE_LINES: { c: string; t: string }[] = [
  { c: "text-mk-blue",   t: "opening secure channel to lumen://rag" },
  { c: "text-mk-green",  t: "handshake ok · encryption AES-256" },
  { c: "text-ink-dim",   t: "resolving scope graph…" },
  { c: "text-mk-purple", t: "seeding embedder · bge-large-en-v1.5" },
  { c: "text-ink-dim",   t: "ranking neighbours · cosine ↑" },
  { c: "text-mk-yellow", t: "assembling context window" },
  { c: "text-prompt",    t: "streaming inference…" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="inline-flex items-center gap-1 rounded border border-chrome-border bg-bg-soft/70 px-1.5 py-[2px] text-[9.5px] tracking-[0.14em] text-ink-dim hover:border-mk-green/50 hover:text-mk-green"
      title="copy answer"
    >
      {copied ? (
        <>
          <Check className="h-2.5 w-2.5" /> copied
        </>
      ) : (
        <>
          <Copy className="h-2.5 w-2.5" /> copy
        </>
      )}
    </button>
  );
}

const REVEALED = new Set<string>();

function TypewriterMarkdown({ content, id }: { content: string; id: string }) {
  const skipAnim = REVEALED.has(id);
  const [n, setN] = useState(skipAnim ? content.length : 0);
  useEffect(() => {
    if (skipAnim) return;
    // per-tick chars scale with length so long answers finish in ~1.5s
    const per = Math.max(2, Math.ceil(content.length / 90));
    const id2 = setInterval(() => {
      setN((v) => {
        const next = Math.min(v + per, content.length);
        if (next >= content.length) {
          clearInterval(id2);
          REVEALED.add(id);
        }
        return next;
      });
    }, 18);
    return () => clearInterval(id2);
  }, [content, skipAnim, id]);

  const shown = content.slice(0, n);
  const done = n >= content.length;
  return (
    <div className="prose-warp min-w-0 max-w-full text-[13.5px] leading-relaxed text-ink">
      <ReactMarkdown components={MD_COMPONENTS}>{shown}</ReactMarkdown>
      {!done && <span className="caret text-prompt align-baseline" />}
    </div>
  );
}

function LoadingBody() {
  const [n, setN] = useState(1);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = setInterval(() => setMs(Math.floor(performance.now() - t0)), 47);
    const grow = setInterval(
      () => setN((v) => Math.min(v + 1, TRACE_LINES.length)),
      520
    );
    return () => {
      clearInterval(tick);
      clearInterval(grow);
    };
  }, []);

  const shown = TRACE_LINES.slice(0, n);

  return (
    <div className="font-mono text-[12px] leading-[1.65] text-ink-dim">
      {shown.map((line, i) => {
        const isLast = i === shown.length - 1;
        const stamp = String(Math.min(ms, 9999)).padStart(4, "0");
        return (
          <div key={i} className="flex gap-2">
            <span className="text-ink-faint">[{stamp.slice(0, -3)}.{stamp.slice(-3)}s]</span>
            <span className={line.c}>▸</span>
            <span>
              {line.t}
              {isLast && <span className="caret text-prompt" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

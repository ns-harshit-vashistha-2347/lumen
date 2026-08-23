"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";
import { Sources } from "./sources";

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
  { c: "text-mk-purple", t: "seeding embedder · text-emb-3" },
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
    <div className="prose-warp">
      <ReactMarkdown>{shown}</ReactMarkdown>
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

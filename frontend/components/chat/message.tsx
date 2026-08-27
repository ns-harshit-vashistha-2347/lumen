"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, Pencil, X as XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";
import { AnswerBody } from "./answer-body";
import { SkeletonSources } from "./skeleton-sources";
import { Sources } from "./sources";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  streamingSources?: {
    source?: string | null;
    page?: number | null;
    path?: string | null;
    start_line?: number | null;
    end_line?: number | null;
    symbol_name?: string | null;
    score?: number;
  }[];
  loading?: boolean;
  streaming?: boolean;
  scopeCount?: number;
  at?: Date;
  error?: boolean;
}

interface Props {
  message: ChatMessage;
  onRetry?: (m: ChatMessage) => void;
  onEditResend?: (m: ChatMessage, newContent: string) => void;
}

export function MessageBubble({ message, onRetry, onEditResend }: Props) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-md border animate-fade-in",
        isUser
          ? "border-prompt/30 bg-prompt/[0.06]"
          : "border-chrome-border bg-bg-soft/70",
        message.error && "border-danger/40 bg-danger/[0.05]"
      )}
    >
      <MessageHeader
        message={message}
        showCopy={Boolean(message.content) && !message.loading}
        onRetry={!isUser && onRetry ? () => onRetry(message) : undefined}
        onEdit={isUser && onEditResend ? () => setEditing(true) : undefined}
      />

      <div className="px-3.5 py-3">
        {isUser ? (
          editing ? (
            <EditForm
              initial={message.content}
              onCancel={() => setEditing(false)}
              onSubmit={(text) => {
                setEditing(false);
                onEditResend?.(message, text);
              }}
            />
          ) : (
            <p className="whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-ink">
              {message.content}
            </p>
          )
        ) : message.loading && !message.content ? (
          <LoadingBody />
        ) : (
          <>
            <AnswerBody
              content={message.content || (message.streaming ? "" : "_(no answer)_")}
              sources={message.sources}
              streaming={message.streaming}
            />
            {message.streaming && !message.sources && message.streamingSources && (
              <SkeletonSources hints={message.streamingSources} />
            )}
            {!message.streaming && message.sources && message.sources.length > 0 && (
              <Sources sources={message.sources} />
            )}
          </>
        )}
      </div>
    </article>
  );
}

function MessageHeader({
  message,
  showCopy,
  onRetry,
  onEdit,
}: {
  message: ChatMessage;
  showCopy: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  const isUser = message.role === "user";
  return (
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
          <span className="flex items-center gap-1.5 text-prompt normal-case tracking-normal">
            <span className="h-1.5 w-1.5 rounded-full bg-prompt animate-pulse shadow-[0_0_6px_currentColor]" />
            {message.streaming ? "streaming" : "proc"}
          </span>
        )}
        {!isUser && !message.streaming && !message.loading && !message.error && (
          <span className="flex items-center gap-1.5 text-ok normal-case tracking-normal">
            <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_currentColor]" />
            ok
          </span>
        )}
      </span>

      <span className="flex items-center gap-1.5 text-ink-faint">
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {showCopy && <CopyButton text={message.content} />}
          {onRetry && (
            <IconAction onClick={onRetry} label="regenerate" title="regenerate answer">
              <RefreshCw className="h-2.5 w-2.5" />
              retry
            </IconAction>
          )}
          {onEdit && (
            <IconAction onClick={onEdit} label="edit" title="edit and resend">
              <Pencil className="h-2.5 w-2.5" />
              edit
            </IconAction>
          )}
        </div>
        <span>
          {message.at
            ? message.at.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : ""}
          {isUser && message.scopeCount != null && (
            <span className="ml-3">
              scope <span className="text-prompt">{message.scopeCount || "all"}</span>
            </span>
          )}
        </span>
      </span>
    </header>
  );
}

function IconAction({
  onClick,
  label,
  title,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded border border-chrome-border bg-bg-soft/70 px-1.5 py-[2px] text-[9.5px] tracking-[0.14em] text-ink-dim hover:border-mk-blue/50 hover:text-mk-blue"
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* noop */
        }
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

function EditForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(val.length, val.length);
  }, [val.length]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = val.trim();
        if (t) onSubmit(t);
      }}
      className="flex flex-col gap-2"
    >
      <textarea
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            const t = val.trim();
            if (t) onSubmit(t);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={Math.min(6, Math.max(2, val.split("\n").length))}
        className="w-full resize-none rounded border border-prompt/40 bg-bg-raised px-2.5 py-2 font-mono text-[13px] text-ink focus:border-prompt/70 focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2 text-[10.5px]">
        <span className="mr-auto text-ink-faint">⌘↵ send · esc cancel</span>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded border border-chrome-border px-2 py-1 font-mono text-ink-dim hover:text-ink"
        >
          <XIcon className="h-3 w-3" /> cancel
        </button>
        <button
          type="submit"
          disabled={!val.trim()}
          className="rounded bg-gradient-to-b from-prompt to-prompt-soft px-2.5 py-1 font-mono font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow hover:brightness-110 disabled:opacity-40"
        >
          resend ↵
        </button>
      </div>
    </form>
  );
}

function LoadingBody() {
  return (
    <div className="flex items-center gap-2 font-mono text-[12px] text-ink-dim">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-prompt shadow-[0_0_6px_currentColor]" />
      <span>opening channel</span>
      <span className="caret text-prompt" />
    </div>
  );
}

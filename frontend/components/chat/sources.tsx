"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";

export function Sources({ sources }: { sources: SourceChunk[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  if (!sources.length) return null;

  const topScore = sources.reduce((m, s) => Math.max(m, s.score), 0) || 1;

  return (
    <div className="mt-3 rounded-md border border-chrome-border bg-bg/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-dim hover:text-prompt"
      >
        <span className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-mk-green" />
          <span className="text-mk-green">citations</span>
          <span className="text-ink-faint">·</span>
          <span>
            {sources.length} chunk{sources.length === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-chrome-border p-2 space-y-1.5 animate-slide-up">
          {sources.map((s, i) => {
            const source = (s.metadata?.source as string) || `source ${i + 1}`;
            const page = s.metadata?.page_number as number | undefined;
            const isActive = active === i;
            const bar = Math.max(6, Math.round((s.score / topScore) * 100));
            return (
              <button
                key={i}
                onClick={() => setActive(isActive ? null : i)}
                className={cn(
                  "block w-full rounded border p-2.5 text-left font-mono text-[11.5px] leading-relaxed transition-colors",
                  isActive
                    ? "border-mk-pink/40 bg-mk-pink/[0.05]"
                    : "border-chrome-border bg-bg-soft/60 hover:border-mk-pink/30"
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
                  <span className="flex min-w-0 items-center gap-2 text-mk-pink">
                    <span className="shrink-0 text-mk-comment">[{String(i + 1).padStart(2, "0")}]</span>
                    <span className="truncate">{source}</span>
                    {page ? <span className="text-mk-comment">· p{page}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="hidden h-1 w-14 overflow-hidden rounded-sm bg-chrome-border/70 sm:block">
                      <span
                        className="block h-full bg-mk-green shadow-[0_0_6px_currentColor] text-mk-green"
                        style={{ width: `${bar}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-ink-faint">
                      {s.score.toFixed(3)}
                    </span>
                  </span>
                </div>
                <p
                  className={cn(
                    "whitespace-pre-wrap text-ink-muted",
                    !isActive && "line-clamp-3"
                  )}
                >
                  {s.content}
                </p>
                {!isActive && (
                  <div className="mt-1 text-[10px] text-mk-comment">click to expand ▾</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

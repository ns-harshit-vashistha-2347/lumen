"use client";

import { useState } from "react";
import { ChevronDown, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";
import { SourceViewer } from "./source-viewer";

export function Sources({ sources }: { sources: SourceChunk[] }) {
  // Open by default so users don't have to hunt for their citations —
  // this is the whole point of the RAG pipeline.
  const [open, setOpen] = useState(true);
  const [viewer, setViewer] = useState<SourceChunk | null>(null);
  if (!sources.length) return null;

  const topScore = sources.reduce((m, s) => Math.max(m, s.score), 0) || 1;
  // Group by document so we can badge repeated citations.
  const docCounts = new Map<string, number>();
  sources.forEach((s) => {
    const key =
      (s.metadata?.document_id as string) ||
      (s.metadata?.source as string) ||
      "?";
    docCounts.set(key, (docCounts.get(key) || 0) + 1);
  });

  return (
    <>
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
            <span className="text-ink-faint">·</span>
            <span className="text-mk-blue">click any to open source</span>
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="border-t border-chrome-border p-2 space-y-1.5 animate-slide-up">
            {sources.map((s, i) => {
              const source = (s.metadata?.source as string) || `source ${i + 1}`;
              const page = s.metadata?.page_number as number | undefined;
              const startLine = s.metadata?.start_line as number | undefined;
              const endLine = s.metadata?.end_line as number | undefined;
              const docId =
                (s.metadata?.document_id as string) ||
                (s.metadata?.source as string) ||
                "?";
              const dupes = (docCounts.get(docId) || 1) - 1;
              const bar = Math.max(6, Math.round((s.score / topScore) * 100));
              const canOpen = Boolean(s.metadata?.document_id);
              return (
                <div
                  key={i}
                  className="group rounded border border-chrome-border bg-bg-soft/60 transition-colors hover:border-mk-pink/40"
                >
                  <div className="flex items-start gap-2 p-2.5 font-mono text-[11.5px] leading-relaxed">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
                        <span className="flex min-w-0 items-center gap-2 text-mk-pink">
                          <span className="shrink-0 text-mk-comment">
                            [{String(i + 1).padStart(2, "0")}]
                          </span>
                          <span className="truncate">{source}</span>
                          {page ? (
                            <span className="text-mk-comment">· p{page}</span>
                          ) : startLine && endLine ? (
                            <span className="text-mk-comment">
                              · L{startLine}-{endLine}
                            </span>
                          ) : null}
                          {dupes > 0 && (
                            <span className="rounded-sm border border-mk-yellow/40 bg-mk-yellow/[0.08] px-1 text-[9px] text-mk-yellow">
                              +{dupes} more in doc
                            </span>
                          )}
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
                      <p className="line-clamp-3 whitespace-pre-wrap text-ink-muted">
                        {s.content}
                      </p>
                    </div>
                    {canOpen && (
                      <button
                        type="button"
                        onClick={() => setViewer(s)}
                        title="open source document with this chunk highlighted"
                        className="shrink-0 rounded border border-chrome-border bg-bg-raised px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-mk-blue transition hover:border-mk-blue/60 hover:bg-mk-blue/[0.1] hover:shadow-[0_0_10px_-2px_rgb(var(--c-mk-blue)/0.7)]"
                      >
                        <span className="flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          open
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SourceViewer
        open={viewer !== null}
        onClose={() => setViewer(null)}
        activeSource={viewer}
        allSources={sources}
      />
    </>
  );
}

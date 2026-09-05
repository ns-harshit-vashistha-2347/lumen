"use client";

// Compact "which docs contributed to this answer" strip. Shown above the
// citation list — one bar per unique document, height + color intensity
// proportional to that doc's summed citation score. Clicking a bar toggles
// a filter that only shows citations from that doc in the parent panel.
//
// Small on purpose. Slots between the answer body and the citations panel;
// zero interaction cost when the user doesn't care, single click when they do.

import { useMemo } from "react";
import type { SourceChunk } from "@/lib/rag";
import { cn } from "@/lib/cn";

interface Props {
  sources: SourceChunk[];
  /** null = no filter (show all). string = doc key to show only. */
  filterKey: string | null;
  onFilterKey: (key: string | null) => void;
}

// Same key derivation as sources.tsx so the filter round-trips cleanly.
function docKey(s: SourceChunk): string {
  const md = s.metadata || {};
  return (md.document_id as string) || (md.source as string) || "?";
}

function docLabel(s: SourceChunk): string {
  const md = s.metadata || {};
  return (md.source as string) || (md.path as string) || "unknown";
}

interface DocRow {
  key: string;
  label: string;
  count: number;
  totalScore: number;
}

export function CitationHeatmap({ sources, filterKey, onFilterKey }: Props) {
  const rows = useMemo<DocRow[]>(() => {
    const byKey = new Map<string, DocRow>();
    for (const s of sources) {
      const key = docKey(s);
      const row = byKey.get(key) || {
        key,
        label: docLabel(s),
        count: 0,
        totalScore: 0,
      };
      row.count += 1;
      // Guard against negative or NaN scores from odd rerankers.
      const score = Number.isFinite(s.score) ? Math.max(0, s.score) : 0;
      row.totalScore += score;
      byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => b.totalScore - a.totalScore);
  }, [sources]);

  if (rows.length <= 1) return null; // one-doc answers don't need a heatmap

  const maxScore = rows.reduce((m, r) => Math.max(m, r.totalScore), 0) || 1;

  return (
    <div className="mt-2 rounded-md border border-chrome-border/60 bg-bg/40 p-2">
      <div className="mb-1.5 flex items-center justify-between px-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="text-mk-green">◆</span>
          <span>contribution by doc</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink-dim">{rows.length} sources</span>
        </span>
        {filterKey && (
          <button
            onClick={() => onFilterKey(null)}
            className="text-mk-yellow hover:text-mk-pink"
          >
            clear filter ×
          </button>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        {rows.map((r) => {
          const strength = r.totalScore / maxScore;
          const isActive = filterKey === r.key;
          const isDim = filterKey !== null && !isActive;
          // Bar height mapped into an ergonomic 14–56px band so weak
          // contributors still look clickable.
          const h = Math.round(14 + strength * 42);
          return (
            <button
              key={r.key}
              onClick={() => onFilterKey(isActive ? null : r.key)}
              title={`${r.label} · ${r.count} chunk${r.count === 1 ? "" : "s"} · Σ ${r.totalScore.toFixed(2)}`}
              className={cn(
                "group flex min-w-0 flex-1 flex-col items-stretch gap-1 rounded-sm p-1 text-left transition",
                isActive && "bg-prompt/10 outline outline-1 outline-prompt/60",
                isDim && "opacity-40 hover:opacity-100"
              )}
            >
              <div className="flex h-14 items-end">
                <div
                  className={cn(
                    "w-full rounded-sm transition",
                    isActive
                      ? "bg-prompt shadow-[0_0_10px_-2px_rgb(var(--c-prompt)/0.8)]"
                      : "bg-mk-green/70 group-hover:bg-mk-green"
                  )}
                  style={{
                    height: `${h}px`,
                    // Color intensity signals score strength; a barely-cited doc
                    // reads visually different from a dominant one at a glance.
                    opacity: 0.45 + strength * 0.55,
                  }}
                />
              </div>
              <div className="min-w-0 truncate font-mono text-[10px] leading-tight text-ink-dim group-hover:text-ink">
                {r.label}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                {r.count} · {r.totalScore.toFixed(2)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

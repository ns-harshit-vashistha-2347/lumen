"use client";

import { FileText } from "lucide-react";

interface SourcePreview {
  source?: string | null;
  page?: number | null;
  path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  symbol_name?: string | null;
  score?: number;
}

export function SkeletonSources({ hints }: { hints: SourcePreview[] }) {
  if (!hints || hints.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-mk-green/30 bg-mk-green/[0.04]">
      <div className="flex items-center gap-2 border-b border-mk-green/25 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mk-green">
        <FileText className="h-3 w-3" />
        streaming answer · {hints.length} source{hints.length === 1 ? "" : "s"} located
        <span className="ml-auto flex h-1.5 w-1.5 items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mk-green shadow-[0_0_6px_currentColor]" />
        </span>
      </div>
      <ul className="divide-y divide-chrome-border/40">
        {hints.map((h, i) => {
          const label =
            h.source ||
            h.path ||
            (h.symbol_name ? h.symbol_name : `source ${i + 1}`);
          const loc = h.page
            ? `p${h.page}`
            : h.start_line && h.end_line
            ? `L${h.start_line}-${h.end_line}`
            : null;
          return (
            <li
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-ink-dim"
            >
              <span className="shrink-0 text-mk-comment">[{String(i + 1).padStart(2, "0")}]</span>
              <span className="min-w-0 flex-1 truncate text-mk-pink">{label}</span>
              {loc && <span className="text-mk-comment">{loc}</span>}
              {typeof h.score === "number" && (
                <span className="tabular-nums text-ink-faint">{h.score.toFixed(3)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

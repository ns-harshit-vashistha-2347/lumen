"use client";

// Repo file viewer for the code playground.
//
// Behavior mirrors the doc SourceViewer:
//   - opens a modal showing the file the citation came from
//   - highlights the citation's exact `start_line-end_line` range (pink)
//   - highlights other cited ranges from the SAME file in yellow so a
//     reader can see every point the answer used
//   - stepper cycles through the file's citations
//
// Uses the backend /repos/{id}/file endpoint. When the on-disk clone was
// GC'd after ingest, that endpoint returns a "chunks"-stitched view; we
// show a small banner so the reader knows they're not seeing whole file.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileCode, Loader2, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { reposApi } from "@/lib/rag";
import { MatrixRain } from "@/components/matrix-rain";

export interface RepoCitation {
  /** Unique key so highlight/stepper can identify each one. */
  id: string;
  path: string;
  symbol_name?: string | null;
  symbol_kind?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  content?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  repoId: string;
  active: RepoCitation | null;
  /** Every citation in this answer — used to find other refs in the same file. */
  all?: RepoCitation[];
}

interface FileFetch {
  path: string;
  source: "clone" | "chunks";
  language: string | null;
  content: string;
  total_lines: number | null;
}

export function RepoFileViewer({ open, onClose, repoId, active, all }: Props) {
  const [data, setData] = useState<FileFetch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const path = active?.path || "";

  // Citations that belong to the same file (including active). Sorted by
  // start line so the stepper cycles in reading order.
  const inFile = useMemo<RepoCitation[]>(() => {
    if (!path || !all) return active ? [active] : [];
    const same = all.filter((c) => c.path === path);
    return same.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));
  }, [all, path, active]);

  // Whenever the active prop changes, jump the stepper to it.
  useEffect(() => {
    if (!active) return;
    const idx = inFile.findIndex((c) => c.id === active.id);
    setSelectedIdx(idx >= 0 ? idx : 0);
  }, [active, inFile]);

  const selected = inFile[selectedIdx] || active;

  // Load file text.
  useEffect(() => {
    if (!open || !repoId || !path) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    reposApi
      .file(repoId, path)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof ApiError ? e.detail : "failed to load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoId, path]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Scroll the active range into view.
  useEffect(() => {
    if (!activeLineRef.current) return;
    activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected?.id, data?.content]);

  if (!open) return null;

  const step = (dir: 1 | -1) => {
    if (inFile.length === 0) return;
    setSelectedIdx((i) => (i + dir + inFile.length) % inFile.length);
  };

  const activeRange =
    selected?.start_line && selected?.end_line
      ? { start: selected.start_line, end: selected.end_line }
      : selected?.start_line
      ? { start: selected.start_line, end: selected.start_line }
      : null;

  // Other citations in this file → yellow bands
  const otherRanges = inFile
    .filter((c) => c.id !== selected?.id)
    .flatMap((c) =>
      c.start_line
        ? [{ start: c.start_line, end: c.end_line || c.start_line }]
        : []
    );

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/80 px-4 py-6 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-25">
        <MatrixRain opacity={0.3} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-scanline opacity-40 mix-blend-overlay" />

      <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-md terminal-frame bracket-frame">
        <span className="bracket-corner" />

        {/* header */}
        <div className="relative flex items-center justify-between border-b border-chrome-border bg-chrome/80 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-dim">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/80 shadow-[0_0_6px_currentColor]" />
              <span className="h-2.5 w-2.5 rounded-full bg-warn/80 shadow-[0_0_6px_currentColor]" />
              <span className="h-2.5 w-2.5 rounded-full bg-ok/80 shadow-[0_0_6px_currentColor]" />
            </span>
            <FileCode className="h-3.5 w-3.5 text-mk-blue" />
            <span className="text-prompt">◆</span>
            <span className="neon-text">source viewer</span>
            <span className="text-ink-faint">·</span>
            <span className="min-w-0 truncate text-mk-blue normal-case tracking-normal">
              {path}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {inFile.length > 1 && (
              <>
                <button
                  onClick={() => step(-1)}
                  className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                  title="prev citation in file"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="hud-chip">
                  <span className="k">cite</span>
                  <span className="v pink">
                    {selectedIdx + 1}/{inFile.length}
                  </span>
                </span>
                <button
                  onClick={() => step(1)}
                  className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                  title="next citation in file"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </>
            )}
            {activeRange && (
              <span className="hud-chip">
                <span className="k">L</span>
                <span className="v blue">
                  {activeRange.start}
                  {activeRange.end !== activeRange.start && `-${activeRange.end}`}
                </span>
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-danger"
              aria-label="close viewer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {data?.source === "chunks" && (
          <div className="border-b border-mk-yellow/40 bg-mk-yellow/[0.08] px-4 py-1.5 font-mono text-[10px] text-mk-yellow">
            Showing a chunk-stitched view — the pristine file isn&apos;t on
            disk right now (the repo clone was cleaned up after ingest).
            Uncited regions of the file are elided.
          </div>
        )}

        {/* body */}
        <div className="relative flex-1 overflow-hidden bg-bg/40">
          {loading && (
            <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-prompt" />
              loading file…
            </div>
          )}
          {err && (
            <div className="m-3 rounded border border-danger/40 bg-danger/5 p-3 font-mono text-[11px] text-danger">
              {err}
            </div>
          )}
          {!loading && !err && data && (
            <FileRenderer
              content={data.content}
              language={data.language}
              activeRange={activeRange}
              otherRanges={otherRanges}
              activeLineRef={activeLineRef}
            />
          )}
        </div>

        {/* legend */}
        <div className="border-t border-chrome-border bg-chrome/40 px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-prompt shadow-[0_0_6px_currentColor]" />
              <span className="text-prompt">active</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-mk-yellow shadow-[0_0_6px_currentColor]" />
              <span className="text-mk-yellow">other cited in this file</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileRenderer({
  content,
  language,
  activeRange,
  otherRanges,
  activeLineRef,
}: {
  content: string;
  language: string | null;
  activeRange: { start: number; end: number } | null;
  otherRanges: Array<{ start: number; end: number }>;
  activeLineRef: React.RefObject<HTMLDivElement>;
}) {
  const lines = content.split("\n");
  return (
    <div className="h-full overflow-y-auto">
      <pre
        data-lang={language || undefined}
        className="min-h-full whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-ink"
      >
        {lines.map((raw, i) => {
          const lineNo = i + 1;
          const inActive =
            activeRange && lineNo >= activeRange.start && lineNo <= activeRange.end;
          const inOther =
            !inActive &&
            otherRanges.some((r) => lineNo >= r.start && lineNo <= r.end);
          const isActiveStart = inActive && activeRange && lineNo === activeRange.start;
          return (
            <div
              key={i}
              ref={isActiveStart ? activeLineRef : undefined}
              className={cn(
                "flex gap-3 rounded px-1",
                inActive && "bg-prompt/20 border-l-2 border-prompt",
                inOther && "bg-mk-yellow/15 border-l-2 border-mk-yellow"
              )}
            >
              <span className="w-10 shrink-0 select-none text-right text-ink-faint">
                {lineNo}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words">
                {raw || " "}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

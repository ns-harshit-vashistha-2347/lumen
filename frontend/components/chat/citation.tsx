"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SourceChunk } from "@/lib/rag";
import { cn } from "@/lib/cn";

interface CitationChipProps {
  n: number;
  source: SourceChunk | null;
  onOpen?: (n: number) => void;
}

export function CitationChip({ n, source, onOpen }: CitationChipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const top = r.bottom + 6;
    // Clamp horizontally into viewport
    const desired = r.left;
    const maxLeft = window.innerWidth - 360 - 12;
    setPos({ top, left: Math.max(12, Math.min(desired, maxLeft)) });
  }, [open]);

  if (!source) {
    return (
      <span className="mx-[1px] rounded border border-chrome-border/70 bg-chrome-hover/60 px-1 py-[0px] font-mono text-[10.5px] text-mk-comment">
        [#{n}]
      </span>
    );
  }

  const src =
    (source.metadata?.source as string) ||
    (source.metadata?.path as string) ||
    "source";
  const page =
    (source.metadata?.page_number as number | undefined) ??
    (source.metadata?.page as number | undefined);
  const startLine = source.metadata?.start_line as number | undefined;
  const endLine = source.metadata?.end_line as number | undefined;

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => onOpen?.(n)}
        className={cn(
          "mx-[1px] cursor-pointer rounded border border-mk-green/40 bg-mk-green/[0.08] px-1 py-[0px] font-mono text-[10.5px] font-semibold text-mk-green transition-colors align-baseline",
          "hover:bg-mk-green/[0.18] hover:border-mk-green/70"
        )}
        title={src}
      >
        [#{n}]
      </span>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[80] w-[360px] animate-fade-in"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="pointer-events-auto overflow-hidden rounded-md border border-mk-green/40 bg-bg-soft/95 shadow-block backdrop-blur">
              <div className="flex items-center justify-between gap-2 border-b border-mk-green/30 bg-mk-green/[0.08] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-mk-green">
                <span className="flex min-w-0 items-center gap-2">
                  <span>[#{n}]</span>
                  <span className="truncate text-ink-dim normal-case tracking-normal">
                    {src}
                  </span>
                </span>
                <span className="shrink-0 text-mk-comment">
                  {page ? `p${page}` : startLine && endLine ? `L${startLine}-${endLine}` : ""}
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                {(source.content || "").slice(0, 700)}
                {(source.content?.length || 0) > 700 ? "…" : ""}
              </div>
              <div className="border-t border-chrome-border/60 bg-chrome/50 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.14em] text-mk-comment">
                click chip → jump to full citation
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

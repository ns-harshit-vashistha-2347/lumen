"use client";

// PDF viewer with per-passage highlighting.
//
// The prior implementation dropped the raw PDF into an <iframe> and used
// the URL fragment (#page=N) to jump to the citation's page. That works,
// but the reader still has to hunt visually for the passage on that page.
//
// This version uses pdf.js directly:
//   - render each page to a canvas
//   - overlay pdf.js's text layer (transparent, positioned over the canvas)
//   - locate the citation's text inside that text layer and paint a
//     translucent rect behind the matching spans
//     * active chunk   -> pink
//     * other cited    -> yellow
//
// pdfjs-dist is heavy (~1MB), so this component and pdfjs itself are only
// imported dynamically from source-viewer.tsx — never included in the
// initial chat bundle.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import type { DocumentChunk } from "@/lib/rag";
import { cn } from "@/lib/cn";

type PdfLibType = typeof import("pdfjs-dist");
type PdfDocProxy = Awaited<ReturnType<PdfLibType["getDocument"]> extends { promise: infer P } ? P : never>;
type PdfPageProxy = Awaited<ReturnType<PdfDocProxy["getPage"]>>;

interface HighlightSpec {
  chunkId: string;
  text: string;
  page?: number | null;
  role: "active" | "other";
}

interface Props {
  /** Blob URL for the PDF file (already Bearer-authenticated). */
  pdfUrl: string;
  active: DocumentChunk | null;
  others: DocumentChunk[];
  onSelectChunkId?: (id: string) => void;
}

/** Load pdfjs lazily so it stays out of the initial bundle. */
async function loadPdfJs(): Promise<PdfLibType> {
  const pdfjs = await import("pdfjs-dist");
  // Worker: pdfjs ships a worker script; we point at the ESM build from the
  // same package so bundlers (webpack/turbopack) resolve it correctly.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Extract the first N words of a chunk to use as a search prefix. Short
 * enough to survive text-layer segmentation, long enough to be unique on
 * the page. */
function searchPrefix(text: string, words = 6): string {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, words)
    .join(" ");
}

export function PdfHighlightViewer({ pdfUrl, active, others, onSelectChunkId }: Props) {
  const [pdf, setPdf] = useState<PdfDocProxy | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfLibType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Merge every chunk we might want to paint on the page, tagged by role.
  const highlights = useMemo<HighlightSpec[]>(() => {
    const out: HighlightSpec[] = [];
    if (active) {
      out.push({
        chunkId: active.id,
        text: active.content,
        page: active.page ?? null,
        role: "active",
      });
    }
    for (const c of others) {
      if (active && c.id === active.id) continue;
      out.push({
        chunkId: c.id,
        text: c.content,
        page: c.page ?? null,
        role: "other",
      });
    }
    return out;
  }, [active, others]);

  // Load pdfjs + document.
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setPdf(null);
    (async () => {
      try {
        const lib = await loadPdfJs();
        if (cancelled) return;
        setPdfjs(lib);
        const doc = await lib.getDocument({ url: pdfUrl }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdf(doc);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message || "failed to load pdf");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Scroll the target page into view when active changes.
  useEffect(() => {
    if (!active?.page) return;
    const el = pageRefs.current.get(active.page);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [active?.id, active?.page]);

  if (err) {
    return (
      <div className="m-3 rounded border border-danger/40 bg-danger/5 p-3 font-mono text-[11px] text-danger">
        {err}
      </div>
    );
  }
  if (!pdf || !pdfjs) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-prompt" />
        loading pdf renderer…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto bg-neutral-900/40 py-4"
      data-testid="pdf-highlight-viewer"
    >
      <div className="mx-auto flex max-w-[820px] flex-col items-center gap-4">
        {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((pageNum) => (
          <PdfPage
            key={pageNum}
            pdf={pdf}
            pageNum={pageNum}
            pdfjs={pdfjs}
            highlights={highlights.filter((h) => (h.page ?? pageNum) === pageNum)}
            registerRef={(el) => {
              if (el) pageRefs.current.set(pageNum, el);
              else pageRefs.current.delete(pageNum);
            }}
            onSelectChunkId={onSelectChunkId}
            activeChunkId={active?.id}
          />
        ))}
      </div>
    </div>
  );
}

function PdfPage({
  pdf,
  pageNum,
  pdfjs,
  highlights,
  registerRef,
  onSelectChunkId,
  activeChunkId,
}: {
  pdf: PdfDocProxy;
  pageNum: number;
  pdfjs: PdfLibType;
  highlights: HighlightSpec[];
  registerRef: (el: HTMLDivElement | null) => void;
  onSelectChunkId?: (id: string) => void;
  activeChunkId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PdfPageProxy | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  // Text-layer items reused for highlight computation
  const textItemsRef = useRef<
    Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
      fontName?: string;
    }>
  >([]);

  // Render the page to canvas + text layer, once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(pageNum);
      if (cancelled) return;
      const scale = 1.4;
      const vp = p.getViewport({ scale });
      setViewport({ w: vp.width, h: vp.height });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      if (cancelled) return;

      // We only need the raw text items to compute highlight rectangles.
      // A visible pdfjs text layer isn't required for the highlight to
      // work (the overlay renders on top of the canvas), and skipping it
      // dodges the surface-area churn across pdfjs minors.
      const textContent = await p.getTextContent();
      if (cancelled) return;
      textItemsRef.current = textContent.items as typeof textItemsRef.current;
      setPage(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNum, pdfjs]);

  // Compute highlight rectangles when highlights or layout change.
  const rects = useMemo(() => {
    if (!page || !viewport || textItemsRef.current.length === 0) return [];
    const items = textItemsRef.current;
    // Reconstruct page text with per-char item index so we can range-map
    // a found substring back to text-layer items.
    let plain = "";
    const charOwner: number[] = []; // for each char in `plain`, which item it came from
    for (let i = 0; i < items.length; i++) {
      const s = items[i].str;
      for (let k = 0; k < s.length; k++) charOwner.push(i);
      plain += s;
      // pdfjs strips inter-item spaces; add a light separator so a
      // multi-item passage still matches.
      plain += " ";
      charOwner.push(-1);
    }
    const lowerPlain = plain.toLowerCase();

    const out: Array<{
      role: HighlightSpec["role"];
      chunkId: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];

    for (const h of highlights) {
      const needle = searchPrefix(h.text, 8).toLowerCase();
      if (!needle) continue;
      const idx = lowerPlain.indexOf(needle);
      if (idx < 0) continue;
      const itemStart = charOwner[idx];
      const itemEndChar = idx + needle.length - 1;
      const itemEnd = charOwner[Math.min(itemEndChar, charOwner.length - 1)];
      if (itemStart < 0) continue;
      const endIdx = itemEnd < 0 ? itemStart : itemEnd;
      for (let i = itemStart; i <= endIdx; i++) {
        const it = items[i];
        if (!it || !it.str.trim()) continue;
        // pdfjs transform: [a, b, c, d, e, f] — [e, f] is the origin in
        // page-space (y counted from the bottom). Scale + viewport already
        // baked into `it.transform` when using page.getTextContent with
        // no options, so we translate by viewport height for y.
        const tx = it.transform;
        // Apply viewport transform: pdfjs.Util.transform([[viewport], [item]])
        // Simplified projection assuming no rotation:
        const scale = viewport.h / page.view[3];
        const x = tx[4] * scale;
        const y = viewport.h - tx[5] * scale - it.height * scale;
        const w = it.width * scale;
        const hgt = Math.max(12, it.height * scale + 4);
        out.push({
          role: h.role,
          chunkId: h.chunkId,
          x,
          y,
          w,
          h: hgt,
        });
      }
    }
    return out;
  }, [page, viewport, highlights]);

  return (
    <div
      ref={registerRef}
      className="relative rounded-sm border border-chrome-border bg-white shadow-[0_4px_18px_-8px_rgba(0,0,0,0.6)]"
    >
      <canvas ref={canvasRef} className="block" />
      {/* pdfjs text layer — transparent, on top of canvas */}
      <div
        ref={textLayerRef}
        className="absolute left-0 top-0 select-text text-transparent"
        style={{ pointerEvents: "none" }}
      />
      {/* our highlight overlay */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute left-0 top-0"
        style={viewport ? { width: viewport.w, height: viewport.h } : undefined}
      >
        {rects.map((r, i) => (
          <div
            key={i}
            onClick={() => onSelectChunkId?.(r.chunkId)}
            className={cn(
              "pointer-events-auto absolute cursor-pointer rounded-sm transition",
              r.role === "active"
                ? "bg-pink-400/40 outline outline-2 outline-pink-500/70"
                : "bg-yellow-300/35 outline outline-1 outline-yellow-500/60",
              activeChunkId === r.chunkId ? "shadow-[0_0_14px_rgba(249,38,114,0.6)]" : ""
            )}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          />
        ))}
      </div>
      {/* page number badge */}
      <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
        p{pageNum}
      </span>
    </div>
  );
}

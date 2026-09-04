"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import type { SourceChunk } from "@/lib/rag";
import { docsApi, type DocumentChunk } from "@/lib/rag";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MatrixRain } from "@/components/matrix-rain";

interface Props {
  open: boolean;
  onClose: () => void;
  // The chunk the user clicked. We derive the document from its metadata.
  activeSource: SourceChunk | null;
  // Every source cited in this answer — so if two came from the same doc
  // we can highlight the second one in a different color.
  allSources?: SourceChunk[];
}

const PDF_LIKE = new Set(["pdf"]);

function sourceDocId(s: SourceChunk | null): string | null {
  if (!s) return null;
  const md = s.metadata || {};
  return (md.document_id as string) || (md.doc_id as string) || null;
}

function sourceDocName(s: SourceChunk | null): string {
  if (!s) return "";
  const md = s.metadata || {};
  return (
    (md.source as string) ||
    (md.filename as string) ||
    (md.path as string) ||
    "document"
  );
}

function shortHash(s: string): number {
  // Deterministic small hash for matching a citation to a DocumentChunk row.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function bestChunkMatch(
  target: SourceChunk,
  chunks: DocumentChunk[]
): DocumentChunk | null {
  if (chunks.length === 0) return null;
  // Prefer chunk_index if the citation carries it explicitly.
  const md = target.metadata || {};
  const idx = md.chunk_index as number | undefined;
  if (typeof idx === "number") {
    const hit = chunks.find((c) => c.chunk_index === idx);
    if (hit) return hit;
  }
  // Otherwise: content-prefix match — sturdy enough because Chroma chunks
  // are unique within a doc.
  const stub = (target.content || "").slice(0, 80).trim();
  if (stub) {
    const hit = chunks.find((c) => (c.content || "").includes(stub));
    if (hit) return hit;
  }
  // Last resort: page + first candidate on that page.
  const page = md.page_number as number | undefined;
  if (page != null) {
    const hit = chunks.find((c) => c.page === page);
    if (hit) return hit;
  }
  return null;
}

export function SourceViewer({ open, onClose, activeSource, allSources }: Props) {
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [ext, setExt] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocumentChunk | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const docId = sourceDocId(activeSource);
  const docName = sourceDocName(activeSource);

  // Chunks from allSources that belong to the same document — these get
  // highlighted in a secondary color so the user can see other citations
  // in this doc at a glance.
  const otherChunkIds = useMemo(() => {
    if (!chunks || !allSources) return new Set<string>();
    const ids = new Set<string>();
    for (const s of allSources) {
      if (sourceDocId(s) !== docId) continue;
      if (s === activeSource) continue;
      const m = bestChunkMatch(s, chunks);
      if (m) ids.add(m.id);
    }
    return ids;
  }, [chunks, allSources, docId, activeSource]);

  // Load metadata + chunk list.
  useEffect(() => {
    if (!open || !docId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setChunks(null);
    setSelected(null);
    docsApi
      .chunks(docId)
      .then((r) => {
        if (cancelled) return;
        setChunks(r.chunks);
        setExt(r.extension);
        setFilename(r.filename);
        if (activeSource) {
          const m = bestChunkMatch(activeSource, r.chunks);
          if (m) setSelected(m);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof ApiError ? e.detail : "failed to load document");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, docId, activeSource]);

  // Load PDF as a Blob URL because iframes can't carry Authorization.
  useEffect(() => {
    if (!open || !docId || !PDF_LIKE.has(ext)) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .blobUrl(`/documents/${docId}/raw`)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setPdfBlobUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof ApiError ? e.detail : "failed to load pdf");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPdfBlobUrl(null);
    };
  }, [open, docId, ext]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Auto-scroll active chunk into view for the text renderer.
  useEffect(() => {
    if (!selected || !activeRowRef.current) return;
    activeRowRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [selected?.id]);

  if (!open) return null;

  const pdfSrc = pdfBlobUrl
    ? `${pdfBlobUrl}#page=${selected?.page || 1}&zoom=page-width`
    : null;

  const stepChunk = (dir: 1 | -1) => {
    if (!chunks || chunks.length === 0) return;
    const idx = selected ? chunks.findIndex((c) => c.id === selected.id) : -1;
    const next = idx < 0 ? 0 : (idx + dir + chunks.length) % chunks.length;
    setSelected(chunks[next]);
  };

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
            <FileText className="h-3.5 w-3.5 text-mk-blue" />
            <span className="text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.7)]">◆</span>
            <span className="neon-text">source viewer</span>
            <span className="text-ink-faint">·</span>
            <span className="min-w-0 truncate text-mk-blue normal-case tracking-normal">
              {filename || docName}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {selected && (
              <>
                <button
                  onClick={() => stepChunk(-1)}
                  className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                  title="prev chunk"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="hud-chip">
                  <span className="k">chunk</span>
                  <span className="v pink">
                    {chunks
                      ? chunks.findIndex((c) => c.id === selected.id) + 1
                      : "—"}
                    /{chunks?.length ?? "—"}
                  </span>
                </span>
                <button
                  onClick={() => stepChunk(1)}
                  className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                  title="next chunk"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </>
            )}
            {selected?.page && (
              <span className="hud-chip">
                <span className="k">page</span>
                <span className="v blue">{selected.page}</span>
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

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
          {/* left: document body */}
          <div className="relative overflow-hidden bg-bg/40" ref={bodyRef}>
            {loading && (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-prompt" />
                loading document…
              </div>
            )}
            {err && (
              <div className="m-3 rounded border border-danger/40 bg-danger/5 p-3 font-mono text-[11px] text-danger">
                {err}
              </div>
            )}
            {!loading && !err && PDF_LIKE.has(ext) && (
              pdfSrc ? (
                <iframe
                  key={pdfSrc}
                  src={pdfSrc}
                  title={filename}
                  className="h-full w-full border-0 bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-prompt" />
                  preparing pdf…
                </div>
              )
            )}
            {!loading && !err && !PDF_LIKE.has(ext) && chunks && (
              <TextRenderer
                chunks={chunks}
                selectedId={selected?.id}
                otherIds={otherChunkIds}
                onSelect={(c) => setSelected(c)}
                activeRowRef={activeRowRef}
              />
            )}
          </div>

          {/* right: chunk list */}
          <div className="flex flex-col overflow-hidden border-l border-chrome-border bg-bg-soft/60">
            <div className="border-b border-chrome-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {chunks
                ? `${chunks.length} indexed chunk${chunks.length === 1 ? "" : "s"}`
                : "loading…"}
              {otherChunkIds.size > 0 && (
                <span className="ml-2 text-mk-yellow">
                  · {otherChunkIds.size} other cited
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {(chunks || []).map((c, i) => {
                const isActive = selected?.id === c.id;
                const isOther = otherChunkIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={cn(
                      "block w-full border-b border-chrome-border/40 px-3 py-2 text-left font-mono text-[11px] transition",
                      isActive
                        ? "border-l-2 border-l-prompt bg-prompt/10"
                        : isOther
                        ? "border-l-2 border-l-mk-yellow bg-mk-yellow/[0.06] hover:bg-mk-yellow/[0.12]"
                        : "hover:bg-chrome-hover/40"
                    )}
                  >
                    <div className="mb-0.5 flex items-center justify-between gap-2 text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
                      <span>
                        <span
                          className={
                            isActive
                              ? "text-prompt"
                              : isOther
                              ? "text-mk-yellow"
                              : "text-mk-comment"
                          }
                        >
                          #{c.chunk_index != null ? c.chunk_index : i + 1}
                        </span>
                        {c.page ? (
                          <span className="ml-2 text-mk-blue">p{c.page}</span>
                        ) : c.start_line && c.end_line ? (
                          <span className="ml-2 text-mk-blue">
                            L{c.start_line}-{c.end_line}
                          </span>
                        ) : null}
                      </span>
                      {isActive && (
                        <span className="text-prompt">▸ active</span>
                      )}
                      {!isActive && isOther && (
                        <span className="text-mk-yellow">▸ cited</span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "line-clamp-2 whitespace-pre-wrap text-[10.5px]",
                        isActive ? "text-ink" : "text-ink-dim"
                      )}
                    >
                      {c.content.slice(0, 220)}
                    </p>
                  </button>
                );
              })}
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
                  <span className="text-mk-yellow">other cited</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextRenderer({
  chunks,
  selectedId,
  otherIds,
  onSelect,
  activeRowRef,
}: {
  chunks: DocumentChunk[];
  selectedId?: string;
  otherIds: Set<string>;
  onSelect: (c: DocumentChunk) => void;
  activeRowRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-2 px-5 py-4 font-mono text-[12.5px] leading-relaxed">
        {chunks.map((c, i) => {
          const isActive = c.id === selectedId;
          const isOther = otherIds.has(c.id);
          return (
            <div
              key={c.id}
              ref={isActive ? activeRowRef : undefined}
              onClick={() => onSelect(c)}
              className={cn(
                "cursor-pointer rounded border px-3 py-2 transition",
                isActive
                  ? "border-prompt/70 bg-prompt/10 shadow-[0_0_20px_-6px_rgb(var(--c-prompt)/0.7)]"
                  : isOther
                  ? "border-mk-yellow/60 bg-mk-yellow/[0.06] hover:border-mk-yellow"
                  : "border-chrome-border bg-bg-soft/40 hover:border-chrome-border/80"
              )}
            >
              <div className="mb-1 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
                <span
                  className={
                    isActive
                      ? "text-prompt"
                      : isOther
                      ? "text-mk-yellow"
                      : "text-mk-comment"
                  }
                >
                  chunk #{c.chunk_index != null ? c.chunk_index : i + 1}
                </span>
                {c.page && (
                  <span className="text-mk-blue">· page {c.page}</span>
                )}
                {!c.page && c.start_line && c.end_line && (
                  <span className="text-mk-blue">
                    · L{c.start_line}–{c.end_line}
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "whitespace-pre-wrap break-words",
                  isActive ? "text-ink" : "text-ink-muted"
                )}
              >
                {c.content}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

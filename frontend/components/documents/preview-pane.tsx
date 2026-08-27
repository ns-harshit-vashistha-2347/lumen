"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, X, Hash, Clock, Zap } from "lucide-react";
import { docsApi, type Document, type DocumentPreview } from "@/lib/rag";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  document: Document | null;
  inScope: boolean;
  onClose: () => void;
  onToggleScope: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

export function PreviewPane({ document: doc, inScope, onClose, onToggleScope, onDelete }: Props) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!doc) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    docsApi
      .preview(doc.id, 8)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) toast.error(err.detail);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (!doc) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-chrome-border bg-bg-soft/95 shadow-block backdrop-blur animate-slide-up">
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b border-chrome-border bg-chrome/60 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">
        <span className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-mk-blue" />
          preview
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-ink"
          aria-label="close preview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* filename + meta */}
      <div className="border-b border-chrome-border px-3 py-3">
        <h3 className="break-all font-mono text-[13px] text-ink">{doc.filename}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-mk-comment">
          <span className="flex items-center gap-1">
            <Hash className="h-3 w-3 text-mk-purple" />
            <span className="text-ink-dim">{doc.chunk_count || 0}</span> chunks
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-mk-yellow" />
            <span className="text-ink-dim">
              {new Date(doc.created_at).toLocaleDateString()}
            </span>
          </span>
          <span
            className={
              "flex items-center gap-1 " +
              (doc.status === "completed"
                ? "text-mk-green"
                : doc.status === "failed"
                ? "text-danger"
                : "text-warn")
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
            {doc.status}
          </span>
        </div>
        {doc.error_message && (
          <div className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1 font-mono text-[10.5px] text-danger">
            {doc.error_message}
          </div>
        )}
      </div>

      {/* chunks */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-dim">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading first chunks…
          </div>
        ) : preview && preview.chunks.length > 0 ? (
          <ul className="space-y-2">
            {preview.chunks.map((c, i) => (
              <li
                key={i}
                className="rounded border border-chrome-border bg-bg/60 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-dim"
              >
                <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mk-comment">
                  <span>chunk #{c.chunk_index != null ? c.chunk_index : i + 1}</span>
                  {c.page ? <span className="text-mk-yellow">p{c.page}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-ink-muted">
                  {c.content}
                </p>
              </li>
            ))}
          </ul>
        ) : preview && preview.status !== "completed" ? (
          <div className="rounded border border-chrome-border bg-bg/40 px-3 py-4 text-center font-mono text-[11.5px] text-mk-comment">
            <span className="text-warn">{preview.status}</span> — preview
            unlocks when indexing finishes.
          </div>
        ) : (
          <div className="rounded border border-chrome-border bg-bg/40 px-3 py-4 text-center font-mono text-[11.5px] text-mk-comment">
            no chunks indexed yet.
          </div>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-chrome-border bg-chrome/40 px-3 py-2">
        <button
          onClick={() => onToggleScope(doc.id)}
          disabled={doc.status !== "completed"}
          className={
            "flex-1 rounded border px-2.5 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
            (inScope
              ? "border-mk-green/60 bg-mk-green/[0.12] text-mk-green hover:bg-mk-green/[0.2]"
              : "border-chrome-border bg-bg-raised text-ink-dim hover:border-mk-green/40 hover:text-mk-green")
          }
        >
          {inScope ? "in scope · click to remove" : "add to chat scope"}
        </button>
        <button
          onClick={() => onDelete(doc.id, doc.filename)}
          className="rounded border border-chrome-border bg-bg-raised px-2 py-1.5 font-mono text-[10.5px] text-ink-dim hover:border-danger/40 hover:text-danger"
          title="delete"
        >
          <Zap className="h-3 w-3" />
        </button>
      </div>
    </aside>
  );
}

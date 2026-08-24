"use client";

import Link from "next/link";
import { X, Plus, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { docsApi, type Document } from "@/lib/rag";
import { ApiError } from "@/lib/api";
import { useScope } from "@/lib/scope-store";

export function ScopeBar() {
  const [scope, store] = useScope();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    docsApi
      .list()
      .then((d) => {
        if (!cancelled) setDocs(d);
      })
      .catch((err) => {
        if (!(err instanceof ApiError)) throw err;
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = docs.filter((d) => d.status === "completed");
  const inScope = ready.filter((d) => scope.has(d.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
      <span className="text-ink-dim">
        <span className="text-mk-green">lumen@rag</span>
        <span className="text-ink-faint">:</span>
        <span className="text-mk-blue">~/scope</span>
        <span className="text-ink-faint">$</span>
      </span>

      {loading ? (
        <span className="text-ink-faint">loading…</span>
      ) : inScope.length === 0 ? (
        <>
          <span className="text-ink-faint">
            {ready.length === 0
              ? "no ready documents · upload in library"
              : "all documents (no filter)"}
          </span>
          {ready.length > 0 && (
            <Link
              href="/documents"
              className="ml-1 inline-flex items-center gap-1 rounded border border-dashed border-chrome-border px-2 py-[3px] text-ink-dim hover:border-mk-pink/50 hover:text-mk-pink"
            >
              <Plus className="h-3 w-3" />
              select docs
            </Link>
          )}
        </>
      ) : (
        <>
          <span className="text-ink-faint">
            <span className="text-mk-green">{inScope.length}</span> in scope
          </span>
          {inScope.map((d) => (
            <button
              key={d.id}
              onClick={() => store.remove(d.id)}
              className="group flex items-center gap-1 rounded border border-mk-green/40 bg-mk-green/[0.08] px-2 py-[3px] text-mk-green hover:bg-mk-green/[0.15]"
              title="Remove from scope"
            >
              <span className="max-w-[180px] truncate">{d.filename}</span>
              <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
          <Link
            href="/documents"
            className="ml-1 inline-flex items-center gap-1 rounded px-2 py-[3px] text-ink-faint hover:text-mk-pink"
            aria-label="Edit scope"
            title="Edit scope"
          >
            <Pencil className="h-3 w-3" />
          </Link>
        </>
      )}
    </div>
  );
}

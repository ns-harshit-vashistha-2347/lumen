"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload,
  Trash2,
  CloudUpload,
  Search,
  CheckCheck,
  X as XIcon,
  Keyboard,
  MessageSquare,
  FileText,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { docsApi, type Document } from "@/lib/rag";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useScope } from "@/lib/scope-store";

const ACTIVE_STATUSES = new Set<Document["status"]>([
  "queued",
  "parsing",
  "chunking",
  "embedding",
  "storing",
]);

function fileMeta(name: string): { ext: string; color: string; kind: string } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "pdf":
      return { ext, color: "text-mk-pink", kind: "PDF" };
    case "docx":
    case "doc":
      return { ext, color: "text-mk-blue", kind: "DOC" };
    case "md":
    case "markdown":
      return { ext, color: "text-mk-green", kind: "MD " };
    case "txt":
      return { ext, color: "text-mk-yellow", kind: "TXT" };
    default:
      return { ext: ext || "bin", color: "text-mk-purple", kind: "BIN" };
  }
}

function DocumentsInner() {
  const [scope, store] = useScope();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const data = await docsApi.list();
      setDocs(data);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.detail);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    const hasActive = docs.some((d) => ACTIVE_STATUSES.has(d.status));
    if (!hasActive) return;
    const t = setInterval(loadDocs, 2500);
    return () => clearInterval(t);
  }, [docs, loadDocs]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          await docsApi.upload(file);
          toast.success(`+ ${file.name}`);
        } catch (err) {
          const detail = err instanceof ApiError ? err.detail : "upload failed";
          toast.error(`${file.name}: ${detail}`);
        }
      }
      await loadDocs();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`rm "${name}" — irreversible. proceed?`)) return;
    try {
      await docsApi.delete(id);
      setDocs((d) => d.filter((doc) => doc.id !== id));
      store.remove(id);
      toast.success(`removed ${name}`);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : "delete failed";
      toast.error(detail);
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.filename.toLowerCase().includes(q));
  }, [docs, filter]);

  const ready = useMemo(() => docs.filter((d) => d.status === "completed"), [docs]);
  const processing = useMemo(
    () => docs.filter((d) => ACTIVE_STATUSES.has(d.status)),
    [docs]
  );
  const inScope = ready.filter((d) => scope.has(d.id));
  const totalChunks = docs.reduce((n, d) => n + (d.chunk_count || 0), 0);

  function toggleAll() {
    if (inScope.length === ready.length) store.set([]);
    else store.set(ready.map((d) => d.id));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (filtered.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(filtered.length - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const doc = filtered[cursor];
        if (doc && doc.status === "completed") store.toggle(doc.id);
      } else if (e.key === "a" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleAll();
      } else if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const doc = filtered[cursor];
        if (doc) remove(doc.id, doc.filename);
      } else if (e.key === "/") {
        e.preventDefault();
        (document.getElementById("doc-filter") as HTMLInputElement | null)?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, cursor, store]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  const isEmpty = !loading && docs.length === 0;

  return (
    <div className="relative h-[calc(100vh-2.75rem)] overflow-y-auto bg-bg">
      {/* ambient hacker background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 warp-ambient" />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 warp-grid opacity-[0.3]" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-scanline opacity-40 mix-blend-overlay"
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-5 font-mono">
        {/* header */}
        <LibraryHeader />

        {/* mission-control stat tiles */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="total files"
            value={docs.length}
            color="text-ink"
            hint={`${processing.length} processing`}
          />
          <Tile
            label="ready"
            value={ready.length}
            color="text-mk-green"
            hint="indexed & searchable"
          />
          <Tile
            label="chunks"
            value={totalChunks}
            color="text-mk-purple"
            hint="vector fragments"
          />
          <Tile
            label="in scope"
            value={inScope.length}
            color="text-mk-pink"
            hint={inScope.length === 0 ? "none selected · all searched" : "chat filter active"}
          />
        </div>

        {/* onboarding banner — only when no docs uploaded */}
        {isEmpty && <OnboardingHero onPick={() => fileRef.current?.click()} />}

        {/* main terminal window */}
        <div className="mt-4 overflow-hidden rounded-md border border-chrome-border bg-bg-soft/90 shadow-term backdrop-blur">
          {/* title bar */}
          <div className="flex items-center gap-2 border-b border-chrome-border bg-chrome px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-mk-pink/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-mk-yellow/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-mk-green/90" />
            </div>
            <div className="flex-1 text-center text-[10.5px] tracking-[0.16em] text-ink-faint">
              — lumen · library · ~/documents —
            </div>
            <span className="flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-ink-faint">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full shadow-[0_0_6px_currentColor]",
                  processing.length ? "bg-warn animate-pulse text-warn" : "bg-ok text-ok"
                )}
              />
              {processing.length ? `${processing.length} indexing` : "idle"}
            </span>
          </div>

          {/* action bar — big, obvious upload */}
          <div className="flex flex-wrap items-center gap-2 border-b border-chrome-border bg-bg-soft/60 px-3 py-2.5">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mk-comment" />
              <input
                id="doc-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder='search files…   ( press "/" )'
                className="w-full rounded border border-chrome-border bg-bg py-1.5 pl-7 pr-3 text-[12px] text-ink placeholder:text-mk-comment focus:border-mk-pink focus:outline-none"
              />
            </div>

            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.txt"
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />

            <button
              onClick={toggleAll}
              disabled={ready.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-chrome-border bg-bg px-2.5 py-1.5 text-[11px] text-mk-yellow hover:border-mk-yellow/60 hover:bg-mk-yellow/[0.06] disabled:opacity-40"
              title="a — toggle all in scope"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {inScope.length === ready.length && ready.length > 0 ? "clear scope" : "select all"}
            </button>

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded bg-gradient-to-b from-mk-pink to-prompt-soft px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#1a0410] shadow-glow hover:brightness-110 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "uploading…" : "upload files"}
            </button>
          </div>

          {/* dropzone — bigger + friendlier when empty */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "cursor-pointer border-b border-dashed px-4 text-center text-[11px] transition-colors",
              dragging
                ? "border-mk-pink bg-mk-pink/[0.10] text-mk-pink py-6"
                : docs.length === 0
                ? "border-mk-pink/40 text-mk-comment hover:bg-mk-pink/[0.04] py-6"
                : "border-chrome-border text-mk-comment hover:text-ink py-2.5"
            )}
          >
            {dragging ? (
              <span className="tracking-[0.2em]">
                <CloudUpload className="mr-1.5 inline h-4 w-4" />
                DROP TO IMPORT
              </span>
            ) : (
              <>
                <CloudUpload className="mr-1.5 inline h-3.5 w-3.5" />
                <span className="text-ink-dim">drag &amp; drop</span>{" "}
                <span className="text-mk-yellow">.pdf .docx .md .txt</span>{" "}
                <span className="text-mk-comment">— or click to browse (max 50M)</span>
              </>
            )}
          </div>

          {/* file listing */}
          <div className="bg-bg-soft/40">
            {loading ? (
              <div className="px-4 py-10 text-center text-[12px] text-mk-comment">
                <span className="text-mk-pink">$</span> loading manifest
                <span className="caret text-mk-pink" />
              </div>
            ) : filtered.length === 0 ? (
              docs.length === 0 ? (
                <EmptyList onUpload={() => fileRef.current?.click()} />
              ) : (
                <div className="px-4 py-14 text-center text-[12px] text-mk-comment">
                  <span className="text-mk-pink">grep</span>: no match for{" "}
                  <span className="text-mk-yellow">"{filter}"</span>
                </div>
              )
            ) : (
              <>
                {/* selection helper strip */}
                <div className="border-b border-chrome-border bg-chrome/50 px-4 py-1.5 text-[10.5px] uppercase tracking-[0.16em] text-mk-comment">
                  <span className="text-mk-green">tip:</span>{" "}
                  <span className="normal-case tracking-normal text-ink-dim">
                    click a row to add it to your chat scope · selected docs get searched first
                  </span>
                </div>

                <ul className="divide-y divide-chrome-border/60">
                  {filtered.map((doc, i) => {
                    const isReady = doc.status === "completed";
                    const isInScope = scope.has(doc.id);
                    const isCursor = i === cursor;
                    const meta = fileMeta(doc.filename);
                    return (
                      <li
                        key={doc.id}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => isReady && store.toggle(doc.id)}
                        className={cn(
                          "group flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2.5 text-[12.5px] transition-colors",
                          isCursor
                            ? "border-l-mk-pink bg-line/70"
                            : "border-l-transparent hover:bg-line/40",
                          isInScope && !isCursor && "border-l-mk-green/60 bg-mk-green/[0.06]",
                          !isReady && "cursor-not-allowed"
                        )}
                      >
                        {/* checkbox */}
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border-[1.5px] transition-all",
                            isInScope
                              ? "border-mk-green bg-mk-green/25 shadow-[0_0_8px_rgba(166,226,46,0.45)]"
                              : isReady
                              ? "border-chrome-border group-hover:border-mk-pink/60"
                              : "border-chrome-border/40"
                          )}
                        >
                          {isInScope && (
                            <svg viewBox="0 0 12 12" className="h-3 w-3 text-mk-green">
                              <path
                                d="M2 6.5l2.5 2.5L10 3.5"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>

                        {/* type chip */}
                        <span
                          className={cn(
                            "shrink-0 rounded-sm border border-current/40 bg-bg px-1.5 py-[1px] text-center text-[9.5px] font-bold tracking-[0.12em]",
                            meta.color
                          )}
                        >
                          {meta.kind}
                        </span>

                        {/* filename + meta */}
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate", isReady ? "text-ink" : "text-ink-dim")}>
                            {doc.filename}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-[10.5px] text-mk-comment">
                            <span>
                              {new Date(doc.created_at).toLocaleDateString()}{" "}
                              {new Date(doc.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span className="tabular-nums text-mk-purple">
                              {doc.chunk_count ? `${doc.chunk_count} chunks` : "—"}
                            </span>
                            {doc.error_message && (
                              <span className="text-mk-pink">× {doc.error_message}</span>
                            )}
                          </div>
                        </div>

                        {/* status */}
                        <StatusBadge status={doc.status} />

                        {/* delete */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(doc.id, doc.filename);
                          }}
                          className="rounded p-1 text-mk-comment opacity-0 transition-opacity hover:bg-mk-pink/15 hover:text-mk-pink group-hover:opacity-100"
                          title="d — delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {/* footer status bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-chrome-border bg-chrome/80 px-3 py-1.5 text-[10.5px] text-mk-comment">
              <button
                onClick={() => setShortcutsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded border border-chrome-border bg-bg-soft px-2 py-[2px] text-mk-yellow hover:border-mk-yellow/60"
              >
                <Keyboard className="h-3 w-3" />
                {shortcutsOpen ? "hide" : "shortcuts"} <kbd className="text-mk-comment">?</kbd>
              </button>
              <div className="flex items-center gap-2">
                <span>
                  scope: <span className="text-mk-green">{inScope.length}</span>
                  <span className="text-mk-comment">/</span>
                  <span className="text-ink">{ready.length}</span>
                </span>
                {inScope.length > 0 && (
                  <button
                    onClick={() => store.set([])}
                    className="inline-flex items-center gap-1 rounded border border-chrome-border bg-bg-soft px-1.5 py-[1px] text-[10px] text-mk-pink hover:border-mk-pink/60"
                  >
                    <XIcon className="h-2.5 w-2.5" /> clear
                  </button>
                )}
              </div>
            </div>

            {shortcutsOpen && (
              <div className="flex flex-wrap items-center gap-4 border-t border-chrome-border bg-bg-soft/70 px-3 py-2 text-[10.5px] text-mk-comment animate-slide-up">
                <Key label="j/k" desc="navigate rows" />
                <Key label="space" desc="add / remove from scope" />
                <Key label="a" desc="select all" />
                <Key label="d" desc="delete file" />
                <Key label="/" desc="focus search" />
                <Key label="?" desc="toggle this panel" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* floating action pill — jump to chat */}
      {inScope.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 animate-slide-up">
          <Link
            href="/chat"
            className="group flex items-center gap-3 rounded-full border border-mk-green/60 bg-bg-soft/95 py-2 pl-3 pr-1.5 shadow-[0_10px_40px_-10px_rgba(166,226,46,0.6),0_0_0_1px_rgba(166,226,46,0.15)] backdrop-blur"
          >
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-mk-green shadow-[0_0_6px_currentColor] animate-pulse" />
              <span className="text-mk-green">{inScope.length}</span> selected
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-mk-green to-ok-soft px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#0d1500] group-hover:brightness-110">
              <MessageSquare className="h-3.5 w-3.5" />
              chat with these
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

function LibraryHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <pre className="font-mono text-[10px] leading-[1.1] text-mk-pink drop-shadow-[0_0_8px_rgba(249,38,114,0.35)]">
{String.raw` _    ___ ___ ___    _   _____   __
| |  |_ _| _ ) _ \  /_\ | _ \ \ / /
| |__ | || _ \   / / _ \|   /\ V /
|____|___|___/_|_\/_/ \_\_|_\ |_|`}
        </pre>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
          workspace vault · index &amp; select docs for chat
        </p>
      </div>
      <div className="hidden items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-faint md:flex">
        <span className="flex items-end gap-[2px]">
          <span className="h-1 w-[3px] bg-mk-green/80" />
          <span className="h-2 w-[3px] bg-mk-green/80" />
          <span className="h-3 w-[3px] bg-mk-green" />
        </span>
        <span className="text-mk-green">vault online</span>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-md border border-chrome-border bg-bg-soft/70 px-3 py-2 shadow-block backdrop-blur">
      <div className="text-[9.5px] uppercase tracking-[0.2em] text-mk-comment">{label}</div>
      <div className={cn("mt-0.5 font-mono text-[22px] font-bold tabular-nums leading-none", color)}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-mk-comment">{hint}</div>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[2px] opacity-70", color.replace("text-", "bg-"))}
      />
    </div>
  );
}

function OnboardingHero({ onPick }: { onPick: () => void }) {
  return (
    <div className="mt-4 grid gap-3 rounded-md border border-mk-pink/30 bg-bg-soft/70 p-4 shadow-block backdrop-blur md:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-mk-pink">
          ▸ getting started
        </div>
        <h2 className="mt-1 font-mono text-[18px] font-bold text-ink">
          feed the vault, then chat.
        </h2>
        <ol className="mt-3 space-y-2 font-mono text-[12.5px] text-ink-dim">
          <Step n={1} title="upload documents">
            drag files onto the box below, or hit the big{" "}
            <span className="text-mk-pink">upload files</span> button.
          </Step>
          <Step n={2} title="wait for indexing" icon={<Zap className="h-3.5 w-3.5 text-mk-yellow" />}>
            lumen parses, chunks &amp; embeds them. status turns{" "}
            <span className="text-mk-green">READY</span> when done.
          </Step>
          <Step n={3} title="click to select scope" icon={<FileText className="h-3.5 w-3.5 text-mk-green" />}>
            tap the rows you want to chat with — then use the{" "}
            <span className="text-mk-green">chat with these</span> pill.
          </Step>
        </ol>
      </div>
      <button
        onClick={onPick}
        className="group relative flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-mk-pink/50 bg-bg/60 px-6 py-8 text-center font-mono transition-all hover:border-mk-pink hover:bg-mk-pink/[0.05]"
      >
        <CloudUpload className="h-10 w-10 text-mk-pink drop-shadow-[0_0_10px_rgba(249,38,114,0.5)] transition-transform group-hover:scale-110" />
        <div className="text-[13px] font-bold uppercase tracking-[0.16em] text-mk-pink">
          drop files here
        </div>
        <div className="text-[11px] text-mk-comment">
          pdf · docx · md · txt <span className="text-mk-comment/60">(up to 50 MB)</span>
        </div>
      </button>
    </div>
  );
}

function Step({
  n,
  title,
  children,
  icon,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-mk-pink/40 bg-mk-pink/10 text-[10.5px] font-bold text-mk-pink">
        {n}
      </span>
      <div>
        <div className="flex items-center gap-1.5 text-ink">
          {icon}
          <span>{title}</span>
        </div>
        <div className="text-[11.5px] text-ink-dim">{children}</div>
      </div>
    </li>
  );
}

function EmptyList({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto max-w-md">
        <FileText className="mx-auto h-8 w-8 text-mk-comment/60" />
        <div className="mt-3 font-mono text-[13px] text-ink">
          your vault is empty.
        </div>
        <div className="mt-1 font-mono text-[11.5px] text-mk-comment">
          upload a document above to bootstrap the corpus. anything you feed lumen becomes
          searchable in chat.
        </div>
        <button
          onClick={onUpload}
          className="mt-4 inline-flex items-center gap-1.5 rounded bg-gradient-to-b from-mk-pink to-prompt-soft px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#1a0410] shadow-glow hover:brightness-110"
        >
          <Upload className="h-3.5 w-3.5" />
          upload your first file
        </button>
      </div>
    </div>
  );
}

function Key({ label, desc }: { label: string; desc: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded border border-chrome-border bg-bg px-1.5 py-[1px] font-mono text-[9.5px] text-mk-yellow">
        {label}
      </kbd>
      <span className="text-mk-comment">{desc}</span>
    </span>
  );
}

export default function DocumentsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <DocumentsInner />
      </AppShell>
    </AuthProvider>
  );
}

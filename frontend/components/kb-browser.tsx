"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X, Loader2, Database, FileCode, Sigma, Network,
  ArrowUpRight, ArrowDownLeft, Search,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import {
  codeQueryApi,
  type GraphFileEntry,
  type GraphStats,
  type GraphSymbolEntry,
} from "@/lib/rag";

interface Props {
  open: boolean;
  onClose: () => void;
  repoId: string;
  title?: string;
}

type Tab = "files" | "symbols";

interface SymbolDetail {
  symbol: GraphSymbolEntry;
  callers: GraphSymbolEntry[];
  callees: GraphSymbolEntry[];
  loading: boolean;
}

interface FileDetail {
  path: string;
  importsFiles: string[];
  importsModules: string[];
  importers: string[];
  loading: boolean;
}

export function KbBrowser({ open, onClose, repoId, title }: Props) {
  const [tab, setTab] = useState<Tab>("symbols");
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [files, setFiles] = useState<GraphFileEntry[]>([]);
  const [symbols, setSymbols] = useState<GraphSymbolEntry[]>([]);
  const [query, setQuery] = useState("");
  const [fileFilter, setFileFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [symbolDetail, setSymbolDetail] = useState<SymbolDetail | null>(null);
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await codeQueryApi.graphStats(repoId));
    } catch (err) {
      if (err instanceof ApiError && stats == null) setStats({
        available: false, files: 0, symbols: 0, calls: 0, imports: 0,
      });
    }
  }, [repoId, stats]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "files") {
        setFiles(await codeQueryApi.graphFiles(repoId, query));
      } else {
        setSymbols(await codeQueryApi.graphSymbols(repoId, query, fileFilter));
      }
    } catch (err) {
      if (err instanceof ApiError) console.warn(err.detail);
    } finally {
      setLoading(false);
    }
  }, [repoId, tab, query, fileFilter]);

  useEffect(() => {
    if (!open) return;
    loadStats();
  }, [open, loadStats]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(loadList, query || fileFilter ? 200 : 0);
    return () => clearTimeout(id);
  }, [open, loadList, query, fileFilter]);

  async function openSymbol(s: GraphSymbolEntry) {
    setSymbolDetail({ symbol: s, callers: [], callees: [], loading: true });
    setFileDetail(null);
    try {
      const [callers, callees] = await Promise.all([
        codeQueryApi.callers(repoId, s.name),
        codeQueryApi.callees(repoId, s.name),
      ]);
      setSymbolDetail({
        symbol: s,
        callers: callers as unknown as GraphSymbolEntry[],
        callees: callees as unknown as GraphSymbolEntry[],
        loading: false,
      });
    } catch {
      setSymbolDetail((d) => (d ? { ...d, loading: false } : d));
    }
  }

  async function openFile(f: GraphFileEntry) {
    setFileDetail({
      path: f.path, importsFiles: [], importsModules: [], importers: [], loading: true,
    });
    setSymbolDetail(null);
    try {
      const [outward, inward] = await Promise.all([
        codeQueryApi.imports(repoId, f.path, "from"),
        codeQueryApi.imports(repoId, f.path, "to"),
      ]);
      const out = outward as { files?: string[]; modules?: string[] };
      const inn = inward as { importers?: string[] };
      setFileDetail({
        path: f.path,
        importsFiles: out.files || [],
        importsModules: out.modules || [],
        importers: inn.importers || [],
        loading: false,
      });
    } catch {
      setFileDetail((d) => (d ? { ...d, loading: false } : d));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal>
      <button
        className="flex-1 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="close"
      />
      <aside className="relative h-full w-full max-w-3xl overflow-hidden border-l border-chrome-border bg-bg-soft/95 backdrop-blur-xl">
        <header className="flex items-center justify-between border-b border-chrome-border px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">
            <Database className="h-3.5 w-3.5 text-mk-green" />
            <span>graph kb</span>
            {title && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="text-ink normal-case tracking-normal">{title}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-chrome-hover hover:text-ink"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <StatsRow stats={stats} />

        <div className="flex items-center gap-1 border-b border-chrome-border/60 px-3 pt-2">
          <TabBtn active={tab === "symbols"} onClick={() => setTab("symbols")}>
            <Sigma className="h-3 w-3" /> symbols
          </TabBtn>
          <TabBtn active={tab === "files"} onClick={() => setTab("files")}>
            <FileCode className="h-3 w-3" /> files
          </TabBtn>
        </div>

        <div className="flex items-center gap-2 border-b border-chrome-border/60 px-3 py-2">
          <div className="flex flex-1 items-center gap-2 rounded border border-chrome-border bg-bg-raised px-2 py-1">
            <Search className="h-3 w-3 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "symbols" ? "symbol name…" : "file path…"}
              className="flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          {tab === "symbols" && fileFilter && (
            <button
              onClick={() => setFileFilter("")}
              className="rounded border border-chrome-border px-2 py-1 font-mono text-[10px] text-ink-dim hover:border-danger/50 hover:text-danger"
            >
              file: {shorten(fileFilter, 24)} ×
            </button>
          )}
        </div>

        <div className="flex h-[calc(100vh-13.5rem)]">
          <div className="w-1/2 overflow-y-auto border-r border-chrome-border/60">
            {loading ? (
              <p className="flex items-center gap-2 px-3 py-4 font-mono text-[11.5px] text-ink-dim">
                <Loader2 className="h-3 w-3 animate-spin" /> loading…
              </p>
            ) : tab === "symbols" ? (
              <SymbolList
                symbols={symbols}
                activeId={symbolDetail?.symbol.id}
                onPick={openSymbol}
              />
            ) : (
              <FileList
                files={files}
                activePath={fileDetail?.path}
                onPick={openFile}
                onFilter={(p) => {
                  setFileFilter(p);
                  setTab("symbols");
                }}
              />
            )}
          </div>

          <div className="w-1/2 overflow-y-auto">
            {symbolDetail && (
              <SymbolDetailPane detail={symbolDetail} onPick={openSymbol} />
            )}
            {fileDetail && (
              <FileDetailPane
                detail={fileDetail}
                onPick={(p) =>
                  openFile({ path: p, language: null, symbol_count: 0 })
                }
              />
            )}
            {!symbolDetail && !fileDetail && (
              <p className="px-3 py-4 font-mono text-[11.5px] text-ink-faint">
                select an item to see relationships.
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatsRow({ stats }: { stats: GraphStats | null }) {
  return (
    <div className="grid grid-cols-4 gap-px border-b border-chrome-border/60 bg-chrome/40 px-3 py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
      <Stat label="files" value={stats?.files} />
      <Stat label="symbols" value={stats?.symbols} />
      <Stat label="calls" value={stats?.calls} />
      <Stat label="imports" value={stats?.imports} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <p className="text-ink">{value?.toLocaleString() ?? "…"}</p>
      <p>{label}</p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em]",
        active
          ? "border-chrome-border bg-bg-soft text-ink"
          : "border-transparent text-ink-faint hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function SymbolList({
  symbols,
  activeId,
  onPick,
}: {
  symbols: GraphSymbolEntry[];
  activeId?: string;
  onPick: (s: GraphSymbolEntry) => void;
}) {
  if (!symbols.length) {
    return <Empty label="no symbols match" />;
  }
  return (
    <ul className="divide-y divide-chrome-border/40">
      {symbols.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onPick(s)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left font-mono text-[11.5px] hover:bg-chrome-hover/40",
              activeId === s.id && "bg-prompt/[0.08]"
            )}
          >
            <span className="flex items-center gap-2">
              <KindPill kind={s.kind} />
              <span className="text-mk-pink">{s.name}</span>
            </span>
            <span className="text-[10.5px] text-ink-faint">
              {s.file_path}:{s.start_line}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FileList({
  files,
  activePath,
  onPick,
  onFilter,
}: {
  files: GraphFileEntry[];
  activePath?: string;
  onPick: (f: GraphFileEntry) => void;
  onFilter: (p: string) => void;
}) {
  if (!files.length) return <Empty label="no files match" />;
  return (
    <ul className="divide-y divide-chrome-border/40">
      {files.map((f) => (
        <li
          key={f.path}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 font-mono text-[11.5px]",
            activePath === f.path && "bg-prompt/[0.08]"
          )}
        >
          <button
            onClick={() => onPick(f)}
            className="flex-1 truncate text-left text-ink hover:text-mk-blue"
            title={f.path}
          >
            {f.path}
          </button>
          {f.language && (
            <span className="rounded border border-chrome-border/70 px-1 text-[9.5px] text-mk-purple">
              {f.language}
            </span>
          )}
          <button
            onClick={() => onFilter(f.path)}
            className="text-[10px] text-ink-dim hover:text-mk-green"
            title="filter symbols to this file"
          >
            {f.symbol_count} syms
          </button>
        </li>
      ))}
    </ul>
  );
}

function SymbolDetailPane({
  detail,
  onPick,
}: {
  detail: SymbolDetail;
  onPick: (s: GraphSymbolEntry) => void;
}) {
  const { symbol: s, callers, callees, loading } = detail;
  return (
    <div className="px-3 py-2 font-mono text-[11.5px]">
      <div className="flex items-center gap-2">
        <KindPill kind={s.kind} />
        <span className="text-mk-pink">{s.name}</span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-faint">
        {s.file_path}:{s.start_line}
        {s.end_line !== s.start_line && `-${s.end_line}`}
      </p>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-ink-dim">
          <Loader2 className="h-3 w-3 animate-spin" /> loading edges…
        </p>
      ) : (
        <>
          <RelBlock
            title="callers"
            icon={<ArrowUpRight className="h-3 w-3 text-mk-yellow" />}
            items={callers}
            onPick={onPick}
            empty="no known callers"
          />
          <RelBlock
            title="callees"
            icon={<ArrowDownLeft className="h-3 w-3 text-mk-purple" />}
            items={callees}
            onPick={onPick}
            empty="no known callees"
          />
        </>
      )}
    </div>
  );
}

function RelBlock({
  title,
  icon,
  items,
  onPick,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: GraphSymbolEntry[];
  onPick: (s: GraphSymbolEntry) => void;
  empty: string;
}) {
  return (
    <section className="mt-4">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-dim">
        {icon} {title} <span className="text-ink-faint">· {items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-chrome-border/30 rounded border border-chrome-border/40">
          {items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => onPick(it)}
                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-chrome-hover/40"
              >
                <span className="flex items-center gap-2">
                  <KindPill kind={it.kind} />
                  <span className="text-mk-pink">{it.name}</span>
                </span>
                <span className="text-[10.5px] text-ink-faint">
                  {it.file_path}:{it.start_line}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FileDetailPane({
  detail,
  onPick,
}: {
  detail: FileDetail;
  onPick: (p: string) => void;
}) {
  return (
    <div className="px-3 py-2 font-mono text-[11.5px]">
      <p className="flex items-center gap-2 text-ink">
        <FileCode className="h-3.5 w-3.5 text-mk-blue" /> {detail.path}
      </p>

      {detail.loading ? (
        <p className="mt-3 flex items-center gap-2 text-ink-dim">
          <Loader2 className="h-3 w-3 animate-spin" /> loading edges…
        </p>
      ) : (
        <>
          <FileRel
            title="imports (files)"
            icon={<ArrowDownLeft className="h-3 w-3 text-mk-purple" />}
            items={detail.importsFiles}
            onPick={onPick}
            empty="none"
          />
          <FileRel
            title="imports (modules)"
            icon={<Network className="h-3 w-3 text-mk-blue" />}
            items={detail.importsModules}
            onPick={undefined}
            empty="none"
          />
          <FileRel
            title="imported by"
            icon={<ArrowUpRight className="h-3 w-3 text-mk-yellow" />}
            items={detail.importers}
            onPick={onPick}
            empty="no importers"
          />
        </>
      )}
    </div>
  );
}

function FileRel({
  title,
  icon,
  items,
  onPick,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  onPick?: (p: string) => void;
  empty: string;
}) {
  return (
    <section className="mt-4">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-dim">
        {icon} {title} <span className="text-ink-faint">· {items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-chrome-border/30 rounded border border-chrome-border/40">
          {items.map((p) => (
            <li key={p}>
              {onPick ? (
                <button
                  onClick={() => onPick(p)}
                  className="w-full truncate px-2 py-1 text-left text-ink hover:bg-chrome-hover/40 hover:text-mk-blue"
                  title={p}
                >
                  {p}
                </button>
              ) : (
                <span className="block truncate px-2 py-1 text-ink" title={p}>
                  {p}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KindPill({ kind }: { kind: string }) {
  const cls: Record<string, string> = {
    function: "text-mk-green border-mk-green/40",
    method: "text-mk-green border-mk-green/40",
    class: "text-mk-blue border-mk-blue/40",
    variable: "text-mk-yellow border-mk-yellow/40",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1 py-[1px] text-[9.5px] uppercase tracking-[0.14em]",
        cls[kind] || "text-ink-dim border-chrome-border"
      )}
    >
      {kind}
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="px-3 py-4 font-mono text-[11.5px] text-ink-faint">{label}</p>
  );
}

function shorten(s: string, n: number): string {
  return s.length <= n ? s : "…" + s.slice(s.length - (n - 1));
}

export function KbButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-chrome-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim hover:border-mk-green/50 hover:text-mk-green"
      title="graph kb browser"
    >
      <Database className="h-3 w-3" />
      kb
    </button>
  );
}

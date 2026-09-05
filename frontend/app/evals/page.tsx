"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Play, Trash2, ChevronRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  evalsApi,
  type EvalCase,
  type EvalRun,
  type EvalRunDetail,
  type EvalSuite,
  type EvalVerdict,
} from "@/lib/evals";

function verdictClass(v: EvalVerdict) {
  return v === "pass"
    ? "bg-mk-green text-black"
    : v === "partial"
    ? "bg-mk-yellow text-black"
    : v === "fail"
    ? "bg-danger text-white"
    : "bg-ink-faint/70 text-black";
}

function EvalsInner() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(true);
  const [selectedSuite, setSelectedSuite] = useState<EvalSuite | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setSuitesLoading(true);
    try {
      const rows = await evalsApi.listSuites();
      setSuites(rows);
      // Keep selection consistent if the suite still exists.
      if (selectedSuite) {
        const stillThere = rows.find((s) => s.id === selectedSuite.id);
        setSelectedSuite(stillThere || null);
      }
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    } finally {
      setSuitesLoading(false);
    }
  }, [selectedSuite]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-[calc(100vh-3rem)] grid-cols-[280px_minmax(0,1fr)]">
      {/* left: suite list */}
      <aside className="flex flex-col overflow-hidden border-r border-chrome-border bg-bg-soft/40">
        <div className="flex items-center justify-between border-b border-chrome-border px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-dim">
          <span className="text-mk-green">eval suites</span>
          <button
            onClick={() => setCreating(true)}
            className="rounded border border-chrome-border px-2 py-0.5 text-[9.5px] hover:border-mk-green/60 hover:text-mk-green"
          >
            <Plus className="mr-1 inline h-3 w-3" />
            new
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {suitesLoading && (
            <div className="p-3 font-mono text-[11px] text-ink-dim">
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> loading…
            </div>
          )}
          {!suitesLoading && suites.length === 0 && (
            <div className="p-3 font-mono text-[11px] text-ink-dim">
              No eval suites yet. Create one to start measuring answer quality.
            </div>
          )}
          {suites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSuite(s)}
              className={cn(
                "block w-full border-b border-chrome-border/40 px-3 py-2 text-left font-mono text-[11px] transition",
                selectedSuite?.id === s.id
                  ? "border-l-2 border-l-prompt bg-prompt/10 text-ink"
                  : "text-ink-dim hover:bg-chrome-hover/40 hover:text-ink"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{s.name}</span>
                <span className="text-[9.5px] text-ink-faint">
                  {s.case_count} case{s.case_count === 1 ? "" : "s"}
                </span>
              </div>
              {s.description && (
                <div className="mt-0.5 line-clamp-1 text-[10px] text-ink-faint">
                  {s.description}
                </div>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* right: suite detail or empty state */}
      <main className="overflow-y-auto">
        {selectedSuite ? (
          <SuiteDetail
            suite={selectedSuite}
            onChanged={refresh}
            onDeleted={() => setSelectedSuite(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[12px] text-ink-dim">
            {creating ? null : "select a suite on the left, or create one"}
          </div>
        )}
      </main>

      {creating && (
        <NewSuiteModal
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setSuites((cur) => [s, ...cur]);
            setSelectedSuite(s);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function SuiteDetail({
  suite,
  onChanged,
  onDeleted,
}: {
  suite: EvalSuite;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<EvalRunDetail | null>(null);
  const [newQ, setNewQ] = useState("");
  const [newE, setNewE] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        evalsApi.listCases(suite.id),
        evalsApi.listRuns(suite.id),
      ]);
      setCases(c);
      setRuns(r);
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    }
  }, [suite.id]);

  useEffect(() => {
    void load();
    setOpenRun(null);
    setRunDetail(null);
  }, [suite.id, load]);

  // Auto-poll if any run is still queued/running.
  useEffect(() => {
    const active = runs.some((r) => r.status === "queued" || r.status === "running");
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [runs, load]);

  useEffect(() => {
    if (!openRun) {
      setRunDetail(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await evalsApi.getRun(openRun);
        if (!cancelled) setRunDetail(d);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) toast.error(e.detail);
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [openRun]);

  const addCase = async () => {
    if (!newQ.trim() || !newE.trim()) return;
    try {
      const c = await evalsApi.addCase(suite.id, {
        question: newQ.trim(),
        expected: newE.trim(),
      });
      setCases((cur) => [...cur, c]);
      setNewQ("");
      setNewE("");
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    }
  };

  const startRun = async () => {
    setStarting(true);
    try {
      const r = await evalsApi.startRun(suite.id);
      setRuns((cur) => [r, ...cur]);
      setOpenRun(r.id);
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    } finally {
      setStarting(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete "${suite.name}" and all its cases + runs?`)) return;
    try {
      await evalsApi.deleteSuite(suite.id);
      onDeleted();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    }
  };

  const activeRunPct = (r: EvalRun) => {
    const done = r.pass_count + r.partial_count + r.fail_count + r.error_count;
    return r.total_cases ? Math.round((done / r.total_cases) * 100) : 0;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 font-mono">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg text-ink">{suite.name}</h1>
          {suite.description && (
            <p className="mt-1 text-[12px] text-ink-dim">{suite.description}</p>
          )}
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            {cases.length} case{cases.length === 1 ? "" : "s"} ·{" "}
            {suite.document_ids
              ? `scoped to ${suite.document_ids.length} doc${suite.document_ids.length === 1 ? "" : "s"}`
              : "whole library"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startRun}
            disabled={cases.length === 0 || starting}
            className="flex items-center gap-1 rounded border border-mk-green/50 bg-mk-green/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            {starting ? "queueing…" : "run"}
          </button>
          <button
            onClick={del}
            className="rounded border border-chrome-border p-1 text-ink-faint hover:border-danger/60 hover:text-danger"
            title="delete suite"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* runs */}
      <section>
        <h2 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-mk-blue">
          runs
        </h2>
        {runs.length === 0 ? (
          <p className="rounded border border-chrome-border/60 bg-bg-soft/40 p-3 text-[11px] text-ink-dim">
            No runs yet. Hit <span className="text-mk-green">run</span> to
            execute this suite through the current pipeline.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded border px-3 py-2 text-left text-[11.5px] transition",
                    openRun === r.id
                      ? "border-prompt/60 bg-prompt/5"
                      : "border-chrome-border/60 bg-bg-soft/40 hover:border-mk-blue/50"
                  )}
                >
                  <span className="text-ink-faint">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span className="text-mk-blue">{r.status}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Badge k="pass" v={r.pass_count} />
                    <Badge k="partial" v={r.partial_count} />
                    <Badge k="fail" v={r.fail_count} />
                    {r.error_count > 0 && <Badge k="error" v={r.error_count} />}
                    <span className="ml-2 text-[10px] text-ink-faint">
                      {activeRunPct(r)}%
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition",
                      openRun === r.id && "rotate-90"
                    )}
                  />
                </button>
                {openRun === r.id && (
                  <div className="mt-1 rounded border border-chrome-border/40 bg-bg/40 p-3">
                    {!runDetail ? (
                      <p className="text-[11px] text-ink-dim">
                        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                        loading…
                      </p>
                    ) : (
                      <RunResults detail={runDetail} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* cases */}
      <section>
        <h2 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-mk-blue">
          cases
        </h2>
        <ul className="space-y-1.5">
          {cases.map((c) => (
            <li
              key={c.id}
              className="rounded border border-chrome-border/60 bg-bg-soft/40 p-3 text-[12px]"
            >
              <div className="text-ink">Q: {c.question}</div>
              <div className="mt-1 text-ink-muted">
                <span className="text-mk-pink">expected:</span> {c.expected}
              </div>
              <div className="mt-1 flex items-center justify-end">
                <button
                  onClick={async () => {
                    try {
                      await evalsApi.deleteCase(c.id);
                      setCases((cur) => cur.filter((x) => x.id !== c.id));
                    } catch (e) {
                      if (e instanceof ApiError) toast.error(e.detail);
                    }
                  }}
                  className="text-[10px] text-ink-faint hover:text-danger"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 rounded border border-chrome-border/60 bg-bg-soft/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            add case
          </div>
          <textarea
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            placeholder="Question"
            className="mb-2 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
            rows={2}
          />
          <textarea
            value={newE}
            onChange={(e) => setNewE(e.target.value)}
            placeholder="Expected answer or criteria (e.g. 'must mention X; must not mention Y')"
            className="mb-2 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
            rows={3}
          />
          <button
            onClick={addCase}
            disabled={!newQ.trim() || !newE.trim()}
            className="rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1 text-[10.5px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
          >
            <Plus className="mr-1 inline h-3 w-3" />
            add
          </button>
        </div>
      </section>
    </div>
  );
}

function Badge({ k, v }: { k: EvalVerdict; v: number }) {
  if (v === 0) return null;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.14em]",
        verdictClass(k)
      )}
      title={`${v} ${k}`}
    >
      {k[0]}
      {v}
    </span>
  );
}

function RunResults({ detail }: { detail: EvalRunDetail }) {
  const caseById = useMemo(() => {
    const m = new Map<string, EvalCase>();
    detail.cases.forEach((c) => m.set(c.id, c));
    return m;
  }, [detail.cases]);

  const pctBar = (r: EvalRunDetail) => {
    const total = r.total_cases || 1;
    const seg = (n: number) => `${(n / total) * 100}%`;
    return { p: seg(r.pass_count), pa: seg(r.partial_count), f: seg(r.fail_count), er: seg(r.error_count) };
  };
  const bar = pctBar(detail);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <span>
          {detail.pass_count}/{detail.total_cases} passed
        </span>
        {detail.finished_at && (
          <span className="text-ink-faint">
            · {new Date(detail.finished_at).toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded bg-chrome-border/40">
        <div style={{ width: bar.p }} className="bg-mk-green" />
        <div style={{ width: bar.pa }} className="bg-mk-yellow" />
        <div style={{ width: bar.f }} className="bg-danger" />
        <div style={{ width: bar.er }} className="bg-ink-faint" />
      </div>
      <ul className="divide-y divide-chrome-border/40">
        {detail.results.map((r) => {
          const c = caseById.get(r.case_id);
          return (
            <li key={r.id} className="py-2 text-[11.5px]">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.14em]",
                    verdictClass(r.verdict)
                  )}
                >
                  {r.verdict}
                </span>
                {r.latency_ms != null && (
                  <span className="text-[10px] text-ink-faint">
                    {r.latency_ms}ms
                  </span>
                )}
                <span className="text-ink">{c?.question || "(case gone)"}</span>
              </div>
              {r.judge_reason && (
                <div className="mt-1 text-ink-dim">
                  <span className="text-mk-pink">why:</span> {r.judge_reason}
                </div>
              )}
              {r.actual_answer && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-ink-faint hover:text-mk-blue">
                    show actual answer
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-bg px-2 py-1 text-[11px] leading-relaxed text-ink-muted">
                    {r.actual_answer}
                  </pre>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewSuiteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: EvalSuite) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border border-chrome-border bg-bg-soft p-4 font-mono text-[12px]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-mk-green">
            new eval suite
          </h2>
          <button
            onClick={onClose}
            className="p-0.5 text-ink-faint hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
          placeholder="e.g. legal-doc regression pack"
        />
        <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          description
        </label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="mb-3 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
          rows={3}
          placeholder="optional"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-chrome-border px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            cancel
          </button>
          <button
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await evalsApi.createSuite({
                  name: name.trim(),
                  description: desc.trim() || undefined,
                });
                onCreated(s);
              } catch (e) {
                if (e instanceof ApiError) toast.error(e.detail);
                setBusy(false);
              }
            }}
            className="rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1 text-[11px] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
          >
            {busy ? "creating…" : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EvalsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <EvalsInner />
      </AppShell>
    </AuthProvider>
  );
}

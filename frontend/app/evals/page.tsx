"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Play,
  Trash2,
  ChevronRight,
  Loader2,
  X,
  BookOpen,
  Upload,
  Info,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Sparkles,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { docsApi, type Document } from "@/lib/rag";
import {
  evalsApi,
  type EvalCase,
  type EvalRun,
  type EvalRunDetail,
  type EvalSuite,
  type EvalVerdict,
} from "@/lib/evals";

const HELP_DISMISSED_KEY = "lumen:evals:help-dismissed";

function verdictClass(v: EvalVerdict) {
  return v === "pass"
    ? "bg-mk-green text-black"
    : v === "partial"
    ? "bg-mk-yellow text-black"
    : v === "fail"
    ? "bg-danger text-white"
    : "bg-ink-faint/70 text-black";
}

function statusColor(s: string) {
  if (s === "completed") return "text-mk-green";
  if (s === "running") return "text-mk-blue";
  if (s === "queued") return "text-mk-yellow";
  if (s === "failed") return "text-danger";
  return "text-ink-dim";
}

function StatusPill({ status }: { status: string }) {
  const spinning = status === "running" || status === "queued";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-current/30 bg-current/5 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.14em]",
        statusColor(status)
      )}
    >
      {spinning ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : status === "completed" ? (
        <CheckCircle2 className="h-2.5 w-2.5" />
      ) : status === "failed" ? (
        <XCircle className="h-2.5 w-2.5" />
      ) : (
        <CircleDashed className="h-2.5 w-2.5" />
      )}
      {status}
    </span>
  );
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
      setSelectedSuite((prev) =>
        prev ? rows.find((s) => s.id === prev.id) || null : prev
      );
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    } finally {
      setSuitesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="grid h-[calc(100vh-3rem)] grid-cols-[280px_minmax(0,1fr)]">
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
            <div className="p-4 font-mono text-[11px] text-ink-dim">
              <div className="mb-2 text-mk-green">no suites yet</div>
              <p className="leading-relaxed text-ink-faint">
                A suite is a set of questions with expected answers you can
                replay through your RAG pipeline to catch regressions.
              </p>
              <button
                onClick={() => setCreating(true)}
                className="mt-3 w-full rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20"
              >
                <Sparkles className="mr-1 inline h-3 w-3" />
                create your first suite
              </button>
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

      <main className="overflow-y-auto">
        {selectedSuite ? (
          <SuiteDetail
            suite={selectedSuite}
            onChanged={refresh}
            onDeleted={() => setSelectedSuite(null)}
          />
        ) : (
          <EmptyMainState onCreate={() => setCreating(true)} />
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

function EmptyMainState({ onCreate }: { onCreate: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(HELP_DISMISSED_KEY) === "1");
    } catch {
      /* no-op */
    }
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8 font-mono">
      <div className="rounded-lg border border-mk-green/30 bg-mk-green/5 p-5">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-mk-green">
          <BookOpen className="h-3.5 w-3.5" />
          how evals work
        </div>
        <ol className="space-y-2 text-[12px] leading-relaxed text-ink">
          <li>
            <span className="text-mk-yellow">1.</span> Create a{" "}
            <b>suite</b> — a named bag of test cases, optionally scoped to
            specific documents from your library.
          </li>
          <li>
            <span className="text-mk-yellow">2.</span> Add <b>cases</b>: a{" "}
            <b>question</b> your users would ask, plus what a good{" "}
            <b>expected</b> answer looks like (a full answer, or criteria like
            <span className="mx-1 rounded bg-bg px-1 text-mk-pink">
              must mention X; must not mention Y
            </span>
            ).
          </li>
          <li>
            <span className="text-mk-yellow">3.</span> Click <b>run</b>. Every
            case flows through your live RAG pipeline. A judge LLM then grades
            each answer against the expected criteria.
          </li>
          <li>
            <span className="text-mk-yellow">4.</span> Each case gets a
            verdict:{" "}
            <VerdictChip v="pass" /> everything covered ·{" "}
            <VerdictChip v="partial" /> some/adds noise ·{" "}
            <VerdictChip v="fail" /> misses the point ·{" "}
            <VerdictChip v="error" /> pipeline crashed.
          </li>
        </ol>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={onCreate}
            className="rounded border border-mk-green/50 bg-mk-green/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20"
          >
            <Plus className="mr-1 inline h-3 w-3" />
            new suite
          </button>
          {!dismissed && (
            <button
              onClick={() => {
                try {
                  localStorage.setItem(HELP_DISMISSED_KEY, "1");
                } catch {
                  /* no-op */
                }
                setDismissed(true);
                toast.success("Got it — hidden from now on.");
              }}
              className="text-[10px] text-ink-faint hover:text-ink"
            >
              got it, hide this
            </button>
          )}
        </div>
      </div>
      <div className="text-center text-[11px] text-ink-faint">
        select a suite on the left, or create one above
      </div>
    </div>
  );
}

function VerdictChip({ v }: { v: EvalVerdict }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-block rounded px-1 py-0 text-[9px] uppercase tracking-[0.14em]",
        verdictClass(v)
      )}
    >
      {v}
    </span>
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
  const [importing, setImporting] = useState(false);

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

  useEffect(() => {
    const active = runs.some(
      (r) => r.status === "queued" || r.status === "running"
    );
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
      toast.success("case added");
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    }
  };

  const startRun = async () => {
    if (cases.length === 0) {
      toast.error("Add at least one case before running.");
      return;
    }
    setStarting(true);
    try {
      const r = await evalsApi.startRun(suite.id);
      setRuns((cur) => [r, ...cur]);
      setOpenRun(r.id);
      toast.success("Run queued — grading each case will take a moment.");
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    } finally {
      setStarting(false);
    }
  };

  const del = async () => {
    if (
      !confirm(
        `Delete "${suite.name}" and all its cases + runs? This can't be undone.`
      )
    )
      return;
    try {
      await evalsApi.deleteSuite(suite.id);
      onDeleted();
      onChanged();
      toast.success("suite deleted");
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.detail);
    }
  };

  const activeRunPct = (r: EvalRun) => {
    const done = r.pass_count + r.partial_count + r.fail_count + r.error_count;
    return r.total_cases ? Math.round((done / r.total_cases) * 100) : 0;
  };

  const activeRun = runs.find(
    (r) => r.status === "running" || r.status === "queued"
  );

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
              ? `scoped to ${suite.document_ids.length} doc${
                  suite.document_ids.length === 1 ? "" : "s"
                }`
              : "whole library"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startRun}
            disabled={cases.length === 0 || starting || !!activeRun}
            title={
              cases.length === 0
                ? "Add at least one case first"
                : activeRun
                ? "A run is already in progress"
                : "Run every case through the RAG pipeline and grade with the judge LLM"
            }
            className="flex items-center gap-1 rounded border border-mk-green/50 bg-mk-green/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            {starting ? "queueing…" : activeRun ? "running…" : "run suite"}
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

      {activeRun && (
        <div className="rounded border border-mk-blue/40 bg-mk-blue/5 p-3">
          <div className="flex items-center gap-2 text-[11px] text-mk-blue">
            <Loader2 className="h-3 w-3 animate-spin" />
            run in progress — {activeRunPct(activeRun)}% (
            {activeRun.pass_count +
              activeRun.partial_count +
              activeRun.fail_count +
              activeRun.error_count}
            /{activeRun.total_cases})
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded bg-chrome-border/40">
            <div
              className="h-full bg-mk-blue transition-all"
              style={{ width: `${activeRunPct(activeRun)}%` }}
            />
          </div>
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-mk-blue">
            runs
          </h2>
          <Legend />
        </div>
        {runs.length === 0 ? (
          <p className="rounded border border-chrome-border/60 bg-bg-soft/40 p-3 text-[11px] text-ink-dim">
            No runs yet. Add cases below and hit{" "}
            <span className="text-mk-green">run suite</span> to grade your
            pipeline against them.
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
                  <StatusPill status={r.status} />
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

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-mk-blue">
            cases
          </h2>
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1 rounded border border-chrome-border px-2 py-0.5 text-[10px] text-ink-dim hover:border-mk-blue/50 hover:text-ink"
          >
            <Upload className="h-3 w-3" />
            bulk import
          </button>
        </div>

        {cases.length === 0 ? (
          <p className="rounded border border-chrome-border/60 bg-bg-soft/40 p-3 text-[11px] text-ink-dim">
            No cases yet. Add one below, or click{" "}
            <span className="text-mk-blue">bulk import</span> to paste many at
            once.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {cases.map((c, i) => (
              <li
                key={c.id}
                className="rounded border border-chrome-border/60 bg-bg-soft/40 p-3 text-[12px]"
              >
                <div className="flex gap-2">
                  <span className="mt-0.5 shrink-0 text-[10px] text-ink-faint">
                    #{i + 1}
                  </span>
                  <div className="flex-1">
                    <div className="text-ink">
                      <span className="text-mk-blue">Q:</span> {c.question}
                    </div>
                    <div className="mt-1 text-ink-muted">
                      <span className="text-mk-pink">expected:</span>{" "}
                      {c.expected}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm("Delete this case?")) return;
                      try {
                        await evalsApi.deleteCase(c.id);
                        setCases((cur) => cur.filter((x) => x.id !== c.id));
                      } catch (e) {
                        if (e instanceof ApiError) toast.error(e.detail);
                      }
                    }}
                    className="text-[10px] text-ink-faint hover:text-danger"
                    title="delete case"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 rounded border border-chrome-border/60 bg-bg-soft/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            add case
            <span
              title="Question: what a user asks. Expected: either a full reference answer, or criteria like 'must mention X; must not mention Y'. The judge LLM grades against this."
              className="cursor-help text-ink-faint hover:text-mk-blue"
            >
              <Info className="h-3 w-3" />
            </span>
          </div>
          <textarea
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            placeholder="Question — e.g. What are the payment terms in the MSA?"
            className="mb-2 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
            rows={2}
          />
          <textarea
            value={newE}
            onChange={(e) => setNewE(e.target.value)}
            placeholder="Expected — a full answer, or criteria: 'must mention Net-30; must not mention Net-60'"
            className="mb-2 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
            rows={3}
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-ink-faint">
              Tip: keep questions realistic. Criteria beat verbose reference
              answers for long-lived suites.
            </p>
            <button
              onClick={addCase}
              disabled={!newQ.trim() || !newE.trim()}
              className="rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1 text-[10.5px] uppercase tracking-[0.14em] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
            >
              <Plus className="mr-1 inline h-3 w-3" />
              add
            </button>
          </div>
        </div>
      </section>

      {importing && (
        <BulkImportModal
          onClose={() => setImporting(false)}
          onImported={async (rows) => {
            let ok = 0;
            for (const r of rows) {
              try {
                const c = await evalsApi.addCase(suite.id, {
                  question: r.question,
                  expected: r.expected,
                });
                setCases((cur) => [...cur, c]);
                ok += 1;
              } catch (e) {
                /* keep going, count failures at the end */
                if (e instanceof ApiError) console.warn(e.detail);
              }
            }
            toast.success(
              `Imported ${ok} of ${rows.length} case${
                rows.length === 1 ? "" : "s"
              }.`
            );
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
      <span className="flex items-center gap-1">
        <VerdictChip v="pass" /> pass
      </span>
      <span className="flex items-center gap-1">
        <VerdictChip v="partial" /> partial
      </span>
      <span className="flex items-center gap-1">
        <VerdictChip v="fail" /> fail
      </span>
      <span className="flex items-center gap-1">
        <VerdictChip v="error" /> error
      </span>
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
    return {
      p: seg(r.pass_count),
      pa: seg(r.partial_count),
      f: seg(r.fail_count),
      er: seg(r.error_count),
    };
  };
  const bar = pctBar(detail);
  const passRate = detail.total_cases
    ? Math.round((detail.pass_count / detail.total_cases) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <span className="text-mk-green">
          {passRate}% pass rate
        </span>
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
        {detail.results.length === 0 && detail.status !== "completed" && (
          <li className="py-2 text-[11px] text-ink-dim">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> waiting for
            first result…
          </li>
        )}
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
  const [scope, setScope] = useState<"all" | "docs">("all");
  const [docs, setDocs] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scope !== "docs") return;
    setDocsLoading(true);
    docsApi
      .list()
      .then((rows) => setDocs(rows.filter((d) => d.status === "completed")))
      .catch((e) => {
        if (e instanceof ApiError) toast.error(e.detail);
      })
      .finally(() => setDocsLoading(false));
  }, [scope]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-md border border-chrome-border bg-bg-soft p-4 font-mono text-[12px]">
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
          autoFocus
        />
        <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          description <span className="normal-case text-ink-faint">(optional)</span>
        </label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="mb-3 w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[12px] outline-none focus:border-mk-blue"
          rows={2}
          placeholder="What this suite checks and why it exists."
        />

        <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          document scope
        </label>
        <div className="mb-3 flex gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setScope("all")}
            className={cn(
              "flex-1 rounded border px-2 py-1.5 text-left",
              scope === "all"
                ? "border-mk-green/50 bg-mk-green/10 text-mk-green"
                : "border-chrome-border text-ink-dim hover:border-mk-green/40"
            )}
          >
            <div className="text-[11px]">whole library</div>
            <div className="mt-0.5 text-[9.5px] text-ink-faint">
              runs go against every doc you have ingested
            </div>
          </button>
          <button
            type="button"
            onClick={() => setScope("docs")}
            className={cn(
              "flex-1 rounded border px-2 py-1.5 text-left",
              scope === "docs"
                ? "border-mk-green/50 bg-mk-green/10 text-mk-green"
                : "border-chrome-border text-ink-dim hover:border-mk-green/40"
            )}
          >
            <div className="text-[11px]">specific docs</div>
            <div className="mt-0.5 text-[9.5px] text-ink-faint">
              lock the suite to a fixed set of documents
            </div>
          </button>
        </div>

        {scope === "docs" && (
          <div className="mb-3 max-h-40 overflow-y-auto rounded border border-chrome-border bg-bg p-2">
            {docsLoading ? (
              <div className="p-2 text-[11px] text-ink-dim">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{" "}
                loading documents…
              </div>
            ) : docs.length === 0 ? (
              <div className="p-2 text-[11px] text-ink-dim">
                No completed documents in your library yet. Upload something in
                the <span className="text-mk-blue">library</span> tab first.
              </div>
            ) : (
              docs.map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11.5px] hover:bg-chrome-hover/40"
                >
                  <input
                    type="checkbox"
                    checked={selectedDocs.has(d.id)}
                    onChange={(e) => {
                      setSelectedDocs((cur) => {
                        const next = new Set(cur);
                        if (e.target.checked) next.add(d.id);
                        else next.delete(d.id);
                        return next;
                      });
                    }}
                  />
                  <FileText className="h-3 w-3 text-ink-faint" />
                  <span className="truncate">{d.filename}</span>
                </label>
              ))
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-chrome-border px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            cancel
          </button>
          <button
            disabled={
              !name.trim() ||
              busy ||
              (scope === "docs" && selectedDocs.size === 0)
            }
            onClick={async () => {
              setBusy(true);
              try {
                const s = await evalsApi.createSuite({
                  name: name.trim(),
                  description: desc.trim() || undefined,
                  document_ids:
                    scope === "docs" ? Array.from(selectedDocs) : undefined,
                });
                onCreated(s);
              } catch (e) {
                if (e instanceof ApiError) toast.error(e.detail);
                setBusy(false);
              }
            }}
            className="rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1 text-[11px] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
          >
            {busy ? "creating…" : "create suite"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (rows: { question: string; expected: string }[]) => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"pipe" | "json">("pipe");
  const [busy, setBusy] = useState(false);

  const parse = (): { question: string; expected: string }[] => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
        return parsed
          .map((r) => ({
            question: String(r.question ?? "").trim(),
            expected: String(r.expected ?? "").trim(),
          }))
          .filter((r) => r.question && r.expected);
      } catch (e) {
        toast.error(`JSON parse failed: ${(e as Error).message}`);
        return [];
      }
    }
    // pipe mode: `question || expected` per line
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const parts = l.split("||");
        return {
          question: (parts[0] || "").trim(),
          expected: (parts.slice(1).join("||") || "").trim(),
        };
      })
      .filter((r) => r.question && r.expected);
  };

  const preview = parse();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-md border border-chrome-border bg-bg-soft p-4 font-mono text-[12px]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-mk-green">
            bulk import cases
          </h2>
          <button
            onClick={onClose}
            className="p-0.5 text-ink-faint hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-2 flex gap-1 text-[10.5px]">
          <button
            type="button"
            onClick={() => setMode("pipe")}
            className={cn(
              "rounded border px-2 py-0.5",
              mode === "pipe"
                ? "border-mk-blue/50 bg-mk-blue/10 text-mk-blue"
                : "border-chrome-border text-ink-dim"
            )}
          >
            one per line
          </button>
          <button
            type="button"
            onClick={() => setMode("json")}
            className={cn(
              "rounded border px-2 py-0.5",
              mode === "json"
                ? "border-mk-blue/50 bg-mk-blue/10 text-mk-blue"
                : "border-chrome-border text-ink-dim"
            )}
          >
            JSON array
          </button>
        </div>

        <p className="mb-2 text-[10.5px] text-ink-faint">
          {mode === "pipe" ? (
            <>
              Format:{" "}
              <code className="rounded bg-bg px-1 text-mk-pink">
                question || expected answer or criteria
              </code>
              . One case per line. Lines starting with{" "}
              <code className="text-ink-faint">#</code> are ignored.
            </>
          ) : (
            <>
              A JSON array of objects like{" "}
              <code className="rounded bg-bg px-1 text-mk-pink">
                {"{\"question\": \"...\", \"expected\": \"...\"}"}
              </code>
              .
            </>
          )}
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full resize-none rounded border border-chrome-border bg-bg p-2 text-[11.5px] leading-relaxed outline-none focus:border-mk-blue"
          placeholder={
            mode === "pipe"
              ? "What are the payment terms? || must mention Net-30\nWho signed the MSA? || must name Alice Chen"
              : '[\n  {"question": "What are the payment terms?", "expected": "must mention Net-30"}\n]'
          }
        />

        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10.5px] text-ink-faint">
            {preview.length} valid case{preview.length === 1 ? "" : "s"}{" "}
            parsed
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded border border-chrome-border px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
            >
              cancel
            </button>
            <button
              disabled={preview.length === 0 || busy}
              onClick={async () => {
                setBusy(true);
                await onImported(preview);
                setBusy(false);
              }}
              className="rounded border border-mk-green/50 bg-mk-green/10 px-2 py-1 text-[11px] text-mk-green hover:bg-mk-green/20 disabled:opacity-40"
            >
              {busy ? "importing…" : `import ${preview.length}`}
            </button>
          </div>
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


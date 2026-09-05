"use client";

// Small "how good is this system right now?" chip shown next to citations.
//
// Reads the user's most recent COMPLETED eval run and renders a compact
// pass-rate badge that links to the full run. Silent no-op when no eval
// run exists yet (fresh accounts, or before the first suite is created).
//
// Fetch is cached in-module for 60s so opening ten chat messages doesn't
// hammer /evals/latest — same result is fine across a page render.

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";
import { evalsApi } from "@/lib/evals";

type Latest = Awaited<ReturnType<typeof evalsApi.latest>>["run"];

let _cache: { at: number; value: Latest } | null = null;
let _inflight: Promise<Latest> | null = null;
const CACHE_MS = 60_000;

async function loadLatest(): Promise<Latest> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_MS) return _cache.value;
  if (!_inflight) {
    _inflight = (async () => {
      try {
        const r = await evalsApi.latest();
        _cache = { at: Date.now(), value: r.run };
        return r.run;
      } catch {
        // On error, cache null briefly so we don't retry-storm.
        _cache = { at: Date.now(), value: null };
        return null;
      } finally {
        _inflight = null;
      }
    })();
  }
  return _inflight;
}

export function PipelineHealthChip({ className }: { className?: string }) {
  const [run, setRun] = useState<Latest>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadLatest().then((r) => {
      if (cancelled) return;
      setRun(r);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready || !run) return null;

  const pct = Math.round(run.pass_rate * 100);
  // Traffic-light band on pass rate. Tuning is intentional — most healthy
  // RAG stacks land in the 60-80 range; below 50 is a real problem.
  const tone =
    pct >= 75
      ? "text-mk-green border-mk-green/50 bg-mk-green/[0.08]"
      : pct >= 55
      ? "text-mk-yellow border-mk-yellow/50 bg-mk-yellow/[0.08]"
      : "text-danger border-danger/50 bg-danger/[0.08]";

  const finished = run.finished_at ? new Date(run.finished_at) : null;
  const rel = finished ? relativeAge(finished) : null;

  return (
    <Link
      href={`/evals`}
      title={
        `${run.suite_name}: ${run.pass_count}/${run.total_cases} passed` +
        (rel ? ` · ${rel} ago` : "")
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] transition hover:opacity-100",
        tone,
        className
      )}
    >
      <FlaskConical className="h-3 w-3" />
      <span>pipeline</span>
      <span className="tabular-nums">{pct}%</span>
      {rel && <span className="text-ink-faint normal-case tracking-normal">· {rel}</span>}
    </Link>
  );
}

function relativeAge(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

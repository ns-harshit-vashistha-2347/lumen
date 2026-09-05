"use client";

// "Explain this repo" tour panel.
//
// A collapsible card at the top of the code playground. First-time viewers
// see it expanded once the tour is ready; a regenerate button re-triggers
// the backend Celery task. Polls every 4s while generating.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCcw, BookOpen, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { reposApi } from "@/lib/rag";
import { ApiError } from "@/lib/api";

interface Props {
  repoId: string;
  /** Whether ingest is complete. We won't even attempt to fetch until then. */
  ingested: boolean;
}

export function RepoTour({ repoId, ingested }: Props) {
  const [open, setOpen] = useState(true);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "generating" | "ready" | "error">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    setState((s) => (s === "generating" ? "generating" : "loading"));
    try {
      const r = await reposApi.tour(repoId);
      if (r.status === "ready" && r.tour_markdown) {
        setMarkdown(r.tour_markdown);
        setGeneratedAt(r.generated_at);
        setState("ready");
      } else {
        setState("generating");
      }
    } catch (e) {
      setState("error");
      setErrMsg(e instanceof ApiError ? e.detail : "failed to load tour");
    }
  }, [repoId]);

  useEffect(() => {
    if (!ingested) return;
    void load();
  }, [ingested, load]);

  // Poll while generating. Backend task usually lands in 10-30s.
  useEffect(() => {
    if (state !== "generating") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [state, load]);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await reposApi.regenerateTour(repoId);
      toast.success("regenerating tour…");
      setState("generating");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };

  if (!ingested || state === "idle") return null;

  return (
    <div className="rounded-md border border-chrome-border bg-bg/50">
      <div className="flex items-center justify-between gap-2 border-b border-chrome-border px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-dim">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 hover:text-mk-pink"
        >
          <BookOpen className="h-3 w-3 text-mk-blue" />
          <span className="text-mk-blue">repo tour</span>
          {state === "generating" && (
            <span className="flex items-center gap-1 text-mk-yellow">
              <Loader2 className="h-3 w-3 animate-spin" />
              generating…
            </span>
          )}
          {generatedAt && state === "ready" && (
            <span className="normal-case tracking-normal text-ink-faint">
              · {new Date(generatedAt).toLocaleString()}
            </span>
          )}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          />
        </button>
        <button
          onClick={regenerate}
          disabled={regenerating || state === "generating"}
          className="flex items-center gap-1 rounded border border-chrome-border px-2 py-0.5 text-[9.5px] text-ink-dim hover:border-mk-blue/50 hover:text-mk-blue disabled:opacity-50"
          title="rerun the tour generator"
        >
          <RefreshCcw className={cn("h-3 w-3", regenerating && "animate-spin")} />
          regenerate
        </button>
      </div>

      {open && (
        <div className="px-4 py-3">
          {state === "loading" && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-prompt" /> loading tour…
            </div>
          )}
          {state === "generating" && (
            <div className="font-mono text-[11px] text-ink-dim">
              The tour is being generated. This usually takes 10-30s after
              ingest finishes. This panel will update automatically.
            </div>
          )}
          {state === "error" && (
            <div className="rounded border border-danger/40 bg-danger/5 p-2 font-mono text-[11px] text-danger">
              {errMsg}
            </div>
          )}
          {state === "ready" && markdown && (
            <article className="prose prose-invert prose-sm max-w-none font-mono text-[12.5px] prose-headings:font-mono prose-headings:tracking-tight prose-p:leading-relaxed prose-code:bg-bg-soft prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </article>
          )}
        </div>
      )}
    </div>
  );
}

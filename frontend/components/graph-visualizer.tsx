"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Activity, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  graphApi,
  type GraphStructure,
  type GraphTrace,
  type GraphTraceEvent,
} from "@/lib/chat-history";
import { ApiError } from "@/lib/api";

type GraphName = "query" | "code_query" | "code_ingestion";

interface Props {
  open: boolean;
  onClose: () => void;
  graphName: GraphName;
  traceId?: string | null;
  // Label to show in the header (e.g. the source chat name).
  title?: string;
}

// Simple layered layout: BFS from START, place each layer on a horizontal band.
function layout(structure: GraphStructure) {
  const adj = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  structure.edges.forEach((e) => {
    adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
    rev.set(e.target, [...(rev.get(e.target) || []), e.source]);
  });
  const layers: string[][] = [];
  const seen = new Set<string>();
  const start =
    structure.nodes.find((n) => n.id === "__start__") || structure.nodes[0];
  if (!start) return { positions: new Map(), layers: [] };
  let frontier = [start.id];
  seen.add(start.id);
  while (frontier.length) {
    layers.push(frontier);
    const next: string[] = [];
    frontier.forEach((n) => {
      (adj.get(n) || []).forEach((t) => {
        if (!seen.has(t)) {
          seen.add(t);
          next.push(t);
        }
      });
    });
    frontier = next;
  }
  // Any nodes we didn't reach (rare) — dump at the end
  structure.nodes.forEach((n) => {
    if (!seen.has(n.id)) {
      layers.push([n.id]);
      seen.add(n.id);
    }
  });

  const positions = new Map<string, { x: number; y: number }>();
  const colW = 170;
  const rowH = 68;
  const marginX = 40;
  const marginY = 30;
  layers.forEach((row, li) => {
    row.forEach((id, ci) => {
      positions.set(id, {
        x: marginX + ci * colW,
        y: marginY + li * rowH,
      });
    });
  });
  return { positions, layers };
}

function shortLabel(id: string) {
  if (id === "__start__") return "START";
  if (id === "__end__") return "END";
  return id;
}

export function GraphVisualizer({
  open,
  onClose,
  graphName,
  traceId,
  title,
}: Props) {
  const [structure, setStructure] = useState<GraphStructure | null>(null);
  const [trace, setTrace] = useState<GraphTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setLoading(true);
    (async () => {
      try {
        const s = await graphApi.structure(graphName);
        setStructure(s);
        if (traceId) {
          const t = await graphApi.trace(traceId);
          setTrace(t);
          const lastNode = [...(t.events || [])]
            .reverse()
            .find((e) => e.type === "node");
          setSelectedStep(lastNode?.step ?? null);
        } else {
          setTrace(null);
          setSelectedStep(null);
        }
      } catch (e) {
        setErr(e instanceof ApiError ? e.detail : "failed to load graph");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, graphName, traceId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { positions, width, height } = useMemo(() => {
    if (!structure) return { positions: new Map(), width: 0, height: 0 };
    const laid = layout(structure);
    let w = 0;
    let h = 0;
    laid.positions.forEach((p) => {
      w = Math.max(w, p.x + 130);
      h = Math.max(h, p.y + 50);
    });
    return { positions: laid.positions, width: w + 40, height: h + 40 };
  }, [structure]);

  const visited = useMemo(() => {
    const set = new Set<string>();
    trace?.events.forEach((e) => {
      if (e.type === "node" && e.node) set.add(e.node);
    });
    return set;
  }, [trace]);

  const currentNode = useMemo(() => {
    if (!trace) return null;
    const e =
      trace.events.find(
        (x) => x.type === "node" && x.step === selectedStep
      ) || null;
    return e;
  }, [trace, selectedStep]);

  const isCurrent = (nodeId: string) =>
    currentNode?.type === "node" && currentNode.node === nodeId;

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-md border border-chrome-border bg-bg-soft shadow-block">
        {/* header */}
        <div className="flex items-center justify-between border-b border-chrome-border bg-chrome/70 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-dim">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-danger/70" />
              <span className="h-2 w-2 rounded-full bg-warn/70" />
              <span className="h-2 w-2 rounded-full bg-ok/70" />
            </span>
            <Activity className="h-3 w-3 text-mk-yellow" />
            <span className="text-prompt">◆</span>
            <span>langgraph · {graphName}</span>
            {title && <span className="text-ink-faint">— {title}</span>}
          </span>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-ink"
            aria-label="Close graph visualizer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
          {/* left: graph */}
          <div className="overflow-auto bg-bg/40 p-4">
            {loading && (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                loading graph…
              </div>
            )}
            {err && (
              <div className="rounded border border-danger/40 bg-danger/5 p-3 font-mono text-[11px] text-danger">
                {err}
              </div>
            )}
            {structure && !loading && !err && (
              <svg width={width} height={height} className="max-w-full">
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {structure.edges.map((e, i) => {
                  const s = positions.get(e.source);
                  const t = positions.get(e.target);
                  if (!s || !t) return null;
                  const x1 = s.x + 60;
                  const y1 = s.y + 22;
                  const x2 = t.x + 60;
                  const y2 = t.y + 4;
                  return (
                    <line
                      key={i}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      strokeWidth={1}
                      strokeDasharray={e.conditional ? "4 3" : undefined}
                      className="text-chrome-border stroke-current"
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
                {structure.nodes.map((n) => {
                  const p = positions.get(n.id);
                  if (!p) return null;
                  const current = isCurrent(n.id);
                  const wasVisited = visited.has(n.id);
                  const nodeCls = current
                    ? "fill-prompt/25 stroke-prompt"
                    : wasVisited
                    ? "fill-ok/15 stroke-ok/60"
                    : "fill-bg-raised stroke-chrome-border";
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x}, ${p.y})`}
                      onClick={() => {
                        if (!trace) return;
                        const first = trace.events.find(
                          (e) => e.type === "node" && e.node === n.id
                        );
                        if (first?.step != null) setSelectedStep(first.step);
                      }}
                      className={cn("cursor-pointer", trace ? "" : "cursor-default")}
                    >
                      <rect
                        width="120"
                        height="26"
                        rx="4"
                        className={cn("transition", nodeCls)}
                        strokeWidth={current ? 1.5 : 1}
                      />
                      <text
                        x="60"
                        y="17"
                        textAnchor="middle"
                        className={cn(
                          "font-mono",
                          current
                            ? "fill-prompt"
                            : wasVisited
                            ? "fill-ink"
                            : "fill-ink-dim"
                        )}
                        style={{ fontSize: 10.5, letterSpacing: 0.4 }}
                      >
                        {shortLabel(n.id)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* right: trace panel */}
          <div className="flex flex-col overflow-hidden border-l border-chrome-border bg-bg-soft/60">
            <div className="border-b border-chrome-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {trace ? (
                <>
                  trace <span className="text-mk-yellow">{trace.trace_id.slice(0, 8)}</span>
                </>
              ) : (
                "no trace attached"
              )}
            </div>
            {!trace && (
              <div className="p-3 font-mono text-[11px] text-ink-dim">
                Ask a question in the chat to attach a live trace — each node&apos;s
                input keys and output preview will appear here.
              </div>
            )}
            {trace && (
              <div className="flex-1 overflow-y-auto">
                {trace.events
                  .filter((e) => e.type === "node")
                  .map((e) => (
                    <TraceStep
                      key={e.step}
                      event={e}
                      selected={e.step === selectedStep}
                      onSelect={() => setSelectedStep(e.step ?? null)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceStep({
  event,
  selected,
  onSelect,
}: {
  event: GraphTraceEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(selected);
  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);
  return (
    <div
      className={cn(
        "border-b border-chrome-border/50 px-3 py-2 font-mono text-[11px] transition",
        selected ? "bg-prompt/10" : "hover:bg-chrome-hover/40"
      )}
    >
      <button
        onClick={() => {
          onSelect();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-ink-faint" />
        ) : (
          <ChevronRight className="h-3 w-3 text-ink-faint" />
        )}
        <span className="text-ink-faint">#{event.step}</span>
        <span className={cn("truncate", selected ? "text-prompt" : "text-ink")}>
          {event.node}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-4">
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
              input keys
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {(event.input_snapshot_keys || []).map((k) => (
                <span
                  key={k}
                  className="rounded border border-chrome-border/60 bg-bg-raised/60 px-1.5 py-[1px] text-[10px] text-ink-dim"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
              output keys
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {(event.output_keys || []).map((k) => (
                <span
                  key={k}
                  className="rounded border border-mk-yellow/40 bg-mk-yellow/5 px-1.5 py-[1px] text-[10px] text-mk-yellow"
                >
                  {k}
                </span>
              ))}
              {!(event.output_keys || []).length && (
                <span className="text-[10px] text-ink-faint">(none)</span>
              )}
            </div>
          </div>
          {event.output_preview && Object.keys(event.output_preview).length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
                output preview
              </div>
              <div className="mt-1 space-y-1">
                {Object.entries(event.output_preview).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10px] text-mk-blue">{k}</div>
                    <pre className="max-h-40 overflow-auto rounded border border-chrome-border/60 bg-bg/60 p-1.5 text-[10px] leading-snug text-ink-dim">
                      {v}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GraphButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title="view langgraph"
      className={cn(
        "inline-flex items-center gap-1 rounded border border-chrome-border bg-bg-raised/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim hover:border-mk-yellow/40 hover:text-mk-yellow",
        className
      )}
    >
      <Activity className="h-3 w-3" />
      graph
      <ArrowRight className="h-2.5 w-2.5 opacity-70" />
    </button>
  );
}

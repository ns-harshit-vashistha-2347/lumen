"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Activity, ArrowRight, ChevronDown, ChevronRight, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { MatrixRain } from "@/components/matrix-rain";

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

// Layered top-down layout. A node's layer is (max layer of any parent) + 1
// so diamonds like `rewrite → {dense, bm25} → fusion` render as a proper
// diamond instead of stacking on top of each other. Layers are centered so
// wide rows aren't shoved to the left.
function layout(structure: GraphStructure) {
  const adj = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  structure.edges.forEach((e) => {
    adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
    rev.set(e.target, [...(rev.get(e.target) || []), e.source]);
  });

  const startId =
    structure.nodes.find((n) => n.id === "__start__")?.id || structure.nodes[0]?.id;
  if (!startId) return { positions: new Map(), layers: [] as string[][] };

  // Topological layering: layer(n) = max(layer(parents)) + 1, layer(start)=0.
  // Fall back to BFS depth if there's a cycle (LangGraph loops).
  const depth = new Map<string, number>();
  depth.set(startId, 0);
  const visiting = new Set<string>();
  const compute = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const parents = rev.get(id) || [];
    const d = parents.length
      ? Math.max(...parents.map(compute)) + 1
      : 0;
    depth.set(id, d);
    visiting.delete(id);
    return d;
  };
  structure.nodes.forEach((n) => compute(n.id));

  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  // Preserve node insertion order within a layer so sibling columns don't
  // jitter between renders.
  structure.nodes.forEach((n) => {
    const d = depth.get(n.id);
    if (d != null) layers[d].push(n.id);
  });

  const positions = new Map<string, { x: number; y: number }>();
  // Horizontal flow: layers advance in +x, siblings within a layer stack in +y.
  const colW = 230;
  const rowH = 72;
  const marginX = 40;
  const maxRows = Math.max(1, ...layers.map((row) => row.length));
  const totalHeight = maxRows * rowH;

  layers.forEach((row, li) => {
    const colHeight = row.length * rowH;
    const offsetY = (totalHeight - colHeight) / 2 + 40;
    row.forEach((id, ci) => {
      positions.set(id, {
        x: marginX + li * colW,
        y: offsetY + ci * rowH,
      });
    });
  });
  return { positions, layers };
}

const NODE_W = 168;
const NODE_H = 46;

// Friendly labels + one-line descriptions + phase category so a user can
// understand what the pipeline does at a glance.
const NODE_META: Record<
  string,
  { label: string; desc: string; phase: "input" | "prep" | "retrieve" | "rerank" | "generate" | "verify" | "output" }
> = {
  __start__:        { label: "START",        desc: "user query enters the pipeline",     phase: "input" },
  __end__:          { label: "END",          desc: "final answer returned to user",      phase: "output" },
  prepare:          { label: "prepare",      desc: "normalise query · load history",     phase: "prep" },
  rewrite:          { label: "rewrite",      desc: "expand acronyms · clean up",         phase: "prep" },
  decompose:        { label: "decompose",    desc: "split into sub-questions",           phase: "prep" },
  classify:         { label: "classify",     desc: "route: chit-chat vs retrieval",      phase: "prep" },
  bm25:             { label: "bm25",         desc: "keyword search (sparse)",            phase: "retrieve" },
  dense:            { label: "dense",        desc: "vector search (embedding)",          phase: "retrieve" },
  expand_retrieval: { label: "expand",       desc: "widen the search net",               phase: "retrieve" },
  fusion:           { label: "fusion",       desc: "merge sparse + dense results",       phase: "retrieve" },
  mmr:              { label: "mmr",          desc: "diversify — drop near-duplicates",   phase: "rerank" },
  rerank:           { label: "rerank",       desc: "cross-encoder relevance rerank",     phase: "rerank" },
  compression:      { label: "compress",     desc: "trim to relevant passages only",     phase: "rerank" },
  generation:       { label: "generate",     desc: "llm drafts the answer",              phase: "generate" },
  regenerate:       { label: "regenerate",   desc: "retry after failed verification",    phase: "generate" },
  verify:           { label: "verify",       desc: "grounding check on the answer",      phase: "verify" },
  finalize:         { label: "finalize",     desc: "attach citations · pack response",   phase: "output" },
};

const PHASE_META: Record<
  string,
  { label: string; color: string; dim: string }
> = {
  input:    { label: "INPUT",    color: "rgb(var(--c-ink-dim))",   dim: "rgb(var(--c-ink-dim) / 0.08)" },
  prep:     { label: "PREP",     color: "rgb(var(--c-mk-blue))",   dim: "rgb(var(--c-mk-blue) / 0.08)" },
  retrieve: { label: "RETRIEVE", color: "rgb(var(--c-mk-yellow))", dim: "rgb(var(--c-mk-yellow) / 0.08)" },
  rerank:   { label: "RERANK",   color: "rgb(var(--c-mk-purple))", dim: "rgb(var(--c-mk-purple) / 0.08)" },
  generate: { label: "GENERATE", color: "rgb(var(--c-prompt))",    dim: "rgb(var(--c-prompt) / 0.08)" },
  verify:   { label: "VERIFY",   color: "rgb(var(--c-warn))",      dim: "rgb(var(--c-warn) / 0.08)" },
  output:   { label: "OUTPUT",   color: "rgb(var(--c-mk-green))",  dim: "rgb(var(--c-mk-green) / 0.08)" },
};

function nodeMeta(id: string) {
  return (
    NODE_META[id] || {
      label: id,
      desc: "custom node",
      phase: "prep" as const,
    }
  );
}

function shortLabel(id: string) {
  return nodeMeta(id).label;
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
          // Prefer generation (most informative), else the last node that
          // actually produced output, else the last node overall.
          const nodeEvents = (t.events || []).filter((e) => e.type === "node");
          const gen = nodeEvents.find(
            (e) => e.node === "generation" || e.node === "regenerate"
          );
          const withOutput = [...nodeEvents]
            .reverse()
            .find(
              (e) =>
                e.output_preview &&
                Object.keys(e.output_preview).length > 0
            );
          setSelectedStep(
            gen?.step ?? withOutput?.step ?? nodeEvents.at(-1)?.step ?? null
          );
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
      w = Math.max(w, p.x + NODE_W + 40);
      h = Math.max(h, p.y + NODE_H + 20);
    });
    return { positions: laid.positions, width: w + 60, height: h + 60 };
  }, [structure]);

  // trace playback
  const nodeSteps = useMemo(
    () =>
      (trace?.events || [])
        .filter((e) => e.type === "node")
        .map((e) => e.step)
        .filter((s): s is number => typeof s === "number"),
    [trace],
  );
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (playRef.current) clearInterval(playRef.current);
    if (!playing || nodeSteps.length === 0) return;
    playRef.current = setInterval(() => {
      setSelectedStep((prev) => {
        const idx = nodeSteps.indexOf(prev ?? nodeSteps[0]);
        const next = idx < 0 || idx >= nodeSteps.length - 1 ? nodeSteps[0] : nodeSteps[idx + 1];
        return next;
      });
    }, 900);
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, nodeSteps]);

  const stepIndex = selectedStep != null ? nodeSteps.indexOf(selectedStep) : -1;
  const goPrev = () => {
    if (nodeSteps.length === 0) return;
    const i = stepIndex <= 0 ? nodeSteps.length - 1 : stepIndex - 1;
    setSelectedStep(nodeSteps[i]);
  };
  const goNext = () => {
    if (nodeSteps.length === 0) return;
    const i = stepIndex < 0 || stepIndex >= nodeSteps.length - 1 ? 0 : stepIndex + 1;
    setSelectedStep(nodeSteps[i]);
  };

  // Set of edges that were actually traversed (source visited before target).
  const traversedEdges = useMemo(() => {
    if (!structure || !trace) return new Set<string>();
    const order = new Map<string, number>();
    let i = 0;
    trace.events.forEach((e) => {
      if (e.type === "node" && e.node && !order.has(e.node)) {
        order.set(e.node, i++);
      }
    });
    const s = new Set<string>();
    structure.edges.forEach((e, idx) => {
      const a = order.get(e.source);
      const b = order.get(e.target);
      if (a != null && b != null && a < b) s.add(`${idx}`);
    });
    return s;
  }, [structure, trace]);

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

  const activeEdgeIdx = useMemo(() => {
    if (!structure || !currentNode || currentNode.type !== "node") return new Set<number>();
    const cur = currentNode.node;
    const set = new Set<number>();
    structure.edges.forEach((e, i) => {
      if (e.target === cur) set.add(i);
    });
    return set;
  }, [structure, currentNode]);

  const isCurrent = (nodeId: string) =>
    currentNode?.type === "node" && currentNode.node === nodeId;

  if (!open) return null;
  const totalSteps = nodeSteps.length;
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/80 px-4 py-8 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-30">
        <MatrixRain opacity={0.35} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-scanline opacity-40 mix-blend-overlay" />

      <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-md terminal-frame bracket-frame">
        <span className="bracket-corner" />
        {/* header */}
        <div className="relative flex items-center justify-between border-b border-chrome-border bg-chrome/80 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-dim">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/80 shadow-[0_0_6px_currentColor]" />
              <span className="h-2.5 w-2.5 rounded-full bg-warn/80 shadow-[0_0_6px_currentColor]" />
              <span className="h-2.5 w-2.5 rounded-full bg-ok/80 shadow-[0_0_6px_currentColor]" />
            </span>
            <Activity className="h-3 w-3 text-mk-yellow tick" />
            <span className="text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.7)]">◆</span>
            <span className="neon-text">langgraph</span>
            <span className="text-ink-faint">·</span>
            <span className="text-mk-blue">{graphName}</span>
            {title && <span className="text-ink-faint">— {title}</span>}
          </span>
          <div className="flex items-center gap-3">
            <span className="hud-chip"><span className="k">nodes</span><span className="v">{structure?.nodes.length ?? 0}</span></span>
            <span className="hud-chip"><span className="k">edges</span><span className="v blue">{structure?.edges.length ?? 0}</span></span>
            {trace && (
              <span className="hud-chip"><span className="k">trace</span><span className="v pink">0x{trace.trace_id.slice(0, 6)}</span></span>
            )}
            <button
              onClick={onClose}
              className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-danger"
              aria-label="Close graph visualizer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* playback strip */}
        {trace && totalSteps > 0 && (
          <div className="flex items-center gap-3 border-b border-chrome-border bg-bg/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
            <div className="flex items-center gap-1">
              <button
                onClick={goPrev}
                className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                title="prev node"
              >
                <SkipBack className="h-3 w-3" />
              </button>
              <button
                onClick={() => setPlaying((v) => !v)}
                className={cn(
                  "rounded border p-1 transition",
                  playing
                    ? "border-prompt bg-prompt/20 text-prompt shadow-[0_0_14px_-2px_rgb(var(--c-prompt)/0.7)]"
                    : "border-chrome-border bg-bg-soft/60 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                )}
                title={playing ? "pause" : "play"}
              >
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <button
                onClick={goNext}
                className="rounded border border-chrome-border bg-bg-soft/60 p-1 text-ink-dim hover:border-prompt/50 hover:text-prompt"
                title="next node"
              >
                <SkipForward className="h-3 w-3" />
              </button>
            </div>
            <div className="text-mk-green">
              step <span className="text-ink">{stepIndex >= 0 ? stepIndex + 1 : "—"}</span>{" "}
              <span className="text-ink-faint">/</span> {totalSteps}
            </div>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-bg-soft">
              <div
                className="h-full bg-gradient-to-r from-prompt via-mk-blue to-mk-green shadow-[0_0_10px_rgb(var(--c-prompt)/0.7)] transition-all duration-500"
                style={{
                  width: `${totalSteps ? ((Math.max(0, stepIndex) + 1) / totalSteps) * 100 : 0}%`,
                }}
              />
            </div>
            {currentNode?.type === "node" && (
              <div className="hidden truncate text-mk-yellow md:block">
                ▸ {currentNode.node}
              </div>
            )}
          </div>
        )}

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
          {/* left: graph */}
          <div className="relative overflow-auto bg-bg/40">
            <div aria-hidden className="pointer-events-none absolute inset-0 hacker-grid-fine opacity-40" />
            <div aria-hidden className="pointer-events-none absolute inset-0 crt-vignette" />
            <div className="relative p-4">
            {loading && (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-dim">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-prompt" />
                <span className="glitch neon-text-green" data-text="loading graph…">loading graph…</span>
              </div>
            )}
            {err && (
              <div className="rounded border border-danger/40 bg-danger/5 p-3 font-mono text-[11px] text-danger">
                {err}
              </div>
            )}
            {structure && !loading && !err && (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                style={{ display: "block" }}
                preserveAspectRatio="xMinYMid meet"
              >
                <defs>
                  <marker
                    id="arrow-idle"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--c-chrome-border))" />
                  </marker>
                  <marker
                    id="arrow-active"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--c-prompt))" />
                  </marker>
                  <marker
                    id="arrow-visited"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--c-ok) / 0.75)" />
                  </marker>
                  <linearGradient id="node-current" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--c-prompt-glow))" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="rgb(var(--c-prompt))" stopOpacity="0.25" />
                  </linearGradient>
                  <linearGradient id="node-visited" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--c-ok))" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="rgb(var(--c-ok))" stopOpacity="0.08" />
                  </linearGradient>
                  <linearGradient id="node-idle" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--c-bg-raised))" stopOpacity="1" />
                    <stop offset="100%" stopColor="rgb(var(--c-bg-soft))" stopOpacity="1" />
                  </linearGradient>
                  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <filter id="glow-soft" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="1.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* edges */}
                {structure.edges.map((e, i) => {
                  const s = positions.get(e.source);
                  const t = positions.get(e.target);
                  if (!s || !t) return null;
                  // Right edge of source → left edge of target, horizontal flow
                  const x1 = s.x + NODE_W;
                  const y1 = s.y + NODE_H / 2;
                  const x2 = t.x;
                  const y2 = t.y + NODE_H / 2;
                  const cx = (x1 + x2) / 2;
                  // Bezier curve for smoothness
                  const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
                  const traversed = traversedEdges.has(`${i}`);
                  const active = activeEdgeIdx.has(i);
                  const stroke = active
                    ? "rgb(var(--c-prompt))"
                    : traversed
                    ? "rgb(var(--c-ok) / 0.7)"
                    : "rgb(var(--c-chrome-border))";
                  const marker = active
                    ? "url(#arrow-active)"
                    : traversed
                    ? "url(#arrow-visited)"
                    : "url(#arrow-idle)";
                  return (
                    <g key={i}>
                      <path
                        d={d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={active ? 2 : traversed ? 1.4 : 1}
                        strokeDasharray={e.conditional ? "5 4" : undefined}
                        markerEnd={marker}
                        style={active ? { filter: "url(#glow-soft)" } : undefined}
                      />
                      {/* flowing dot for active edge */}
                      {active && (
                        <circle r="3" fill="rgb(var(--c-prompt-glow))" style={{ filter: "url(#glow)" }}>
                          <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                        </circle>
                      )}
                    </g>
                  );
                })}

                {/* nodes */}
                {structure.nodes.map((n) => {
                  const p = positions.get(n.id);
                  if (!p) return null;
                  const current = isCurrent(n.id);
                  const wasVisited = visited.has(n.id);
                  const meta = nodeMeta(n.id);
                  const phase = PHASE_META[meta.phase];
                  const fill = current
                    ? "url(#node-current)"
                    : wasVisited
                    ? "url(#node-visited)"
                    : "url(#node-idle)";
                  const stroke = current
                    ? "rgb(var(--c-prompt))"
                    : wasVisited
                    ? "rgb(var(--c-ok) / 0.65)"
                    : "rgb(var(--c-chrome-border))";
                  const textFill = current
                    ? "rgb(var(--c-prompt-glow))"
                    : wasVisited
                    ? "rgb(var(--c-ink))"
                    : "rgb(var(--c-ink))";
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
                      className={cn("transition", trace ? "cursor-pointer" : "cursor-default")}
                      style={current ? { filter: "url(#glow)" } : undefined}
                    >
                      <title>{meta.label} — {meta.desc}</title>
                      {/* halo for current */}
                      {current && (
                        <rect
                          x={-4}
                          y={-4}
                          width={NODE_W + 8}
                          height={NODE_H + 8}
                          rx={8}
                          fill="none"
                          stroke="rgb(var(--c-prompt) / 0.4)"
                          strokeWidth={1}
                        >
                          <animate
                            attributeName="stroke-opacity"
                            values="0.15;0.9;0.15"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                        </rect>
                      )}
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={6}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={current ? 1.75 : 1}
                      />
                      {/* phase color stripe on left edge */}
                      <rect
                        x={0}
                        y={0}
                        width={5}
                        height={NODE_H}
                        rx={2.5}
                        fill={phase.color}
                        opacity={current ? 1 : wasVisited ? 0.85 : 0.55}
                      />
                      {/* status pip */}
                      <circle
                        cx={16}
                        cy={13}
                        r={3}
                        fill={
                          current
                            ? "rgb(var(--c-prompt-glow))"
                            : wasVisited
                            ? "rgb(var(--c-ok))"
                            : "rgb(var(--c-ink-faint))"
                        }
                      >
                        {current && (
                          <animate
                            attributeName="opacity"
                            values="0.3;1;0.3"
                            dur="0.9s"
                            repeatCount="indefinite"
                          />
                        )}
                      </circle>
                      {/* phase label */}
                      <text
                        x={NODE_W - 8}
                        y={13}
                        textAnchor="end"
                        fill={phase.color}
                        opacity={0.85}
                        style={{
                          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                          fontSize: 8.5,
                          fontWeight: 600,
                          letterSpacing: 1,
                        }}
                      >
                        {phase.label}
                      </text>
                      {/* node name */}
                      <text
                        x={24}
                        y={28}
                        fill={textFill}
                        style={{
                          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                          fontSize: 13,
                          fontWeight: current ? 700 : 600,
                          letterSpacing: 0.3,
                        }}
                      >
                        {meta.label}
                      </text>
                      {/* description */}
                      <text
                        x={24}
                        y={NODE_H - 6}
                        fill={
                          current
                            ? "rgb(var(--c-prompt-glow) / 0.85)"
                            : "rgb(var(--c-ink-dim))"
                        }
                        style={{
                          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                          fontSize: 9,
                          letterSpacing: 0.2,
                        }}
                      >
                        {meta.desc.length > 30 ? meta.desc.slice(0, 29) + "…" : meta.desc}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
            </div>
            {/* legend */}
            {structure && !loading && !err && (
              <div className="sticky bottom-0 border-t border-chrome-border bg-bg/85 px-3 py-2 backdrop-blur">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">
                  <span className="text-ink-dim">phases:</span>
                  {Object.entries(PHASE_META).map(([k, m]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }}
                      />
                      <span style={{ color: m.color }}>{m.label}</span>
                    </span>
                  ))}
                  <span className="ml-auto flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-ink-faint" />
                      <span>idle</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-ok shadow-[0_0_6px_currentColor] text-ok" />
                      <span className="text-ok">visited</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-prompt shadow-[0_0_6px_currentColor] text-prompt animate-pulse" />
                      <span className="text-prompt">current</span>
                    </span>
                  </span>
                </div>
              </div>
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
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-ink-dim">
                <p className="mb-2">
                  <span className="text-prompt">▸</span> Ask a question in the chat
                  to attach a <span className="text-mk-yellow">live trace</span>.
                  Nodes will glow as they execute and you&apos;ll see their input
                  keys + output preview here.
                </p>
                <div className="mt-3 rounded border border-chrome-border bg-bg/60 p-2">
                  <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">
                    how the pipeline works
                  </div>
                  <ol className="space-y-1.5">
                    {(Object.keys(PHASE_META) as (keyof typeof PHASE_META)[]).map((k, i) => {
                      const m = PHASE_META[k];
                      const blurbs: Record<string, string> = {
                        input: "your question enters",
                        prep: "clean up · rewrite · decompose",
                        retrieve: "sparse + dense search over your corpus",
                        rerank: "cross-encoder rank · diversify · compress",
                        generate: "llm drafts a grounded answer",
                        verify: "self-check citations · retry if weak",
                        output: "attach sources · return",
                      };
                      return (
                        <li key={k} className="flex items-start gap-2">
                          <span
                            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold"
                            style={{
                              background: m.dim,
                              color: m.color,
                              boxShadow: `0 0 6px ${m.color}55`,
                            }}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <div
                              className="text-[10.5px] font-semibold tracking-[0.14em]"
                              style={{ color: m.color }}
                            >
                              {m.label}
                            </div>
                            <div className="text-[10.5px] text-ink-dim">{blurbs[k]}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <div className="mt-2 text-[10px] text-ink-faint">
                  <span className="text-mk-comment">tip:</span> click any node in the
                  graph to jump to that step in a live trace.
                </div>
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
        className="flex w-full items-start gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" />
        )}
        {(() => {
          const meta = nodeMeta(event.node || "");
          const phase = PHASE_META[meta.phase];
          return (
            <>
              <span
                className="mt-0.5 inline-block h-3 w-[3px] shrink-0 rounded-sm"
                style={{ background: phase.color, boxShadow: `0 0 4px ${phase.color}` }}
              />
              <span className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-ink-faint">#{event.step}</span>
                  <span className={cn("truncate", selected ? "text-prompt" : "text-ink")}>
                    {meta.label}
                  </span>
                  <span
                    className="ml-auto rounded-sm px-1 text-[8.5px] uppercase tracking-[0.18em]"
                    style={{ color: phase.color, background: phase.dim }}
                  >
                    {phase.label}
                  </span>
                </div>
                <div className="truncate text-[10px] text-ink-dim">{meta.desc}</div>
              </span>
            </>
          );
        })()}
      </button>
      {open && (
        <div className="mt-2 space-y-3 pl-4">
          {event.output_preview && Object.keys(event.output_preview).length > 0 ? (
            <div>
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">
                output
              </div>
              <div className="space-y-2">
                {Object.entries(event.output_preview).map(([k, v]) => (
                  <OutputField key={k} label={k} value={v} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] italic text-ink-faint">
              this node produced no state updates
            </div>
          )}
          <details className="group">
            <summary className="cursor-pointer text-[9.5px] uppercase tracking-[0.16em] text-ink-faint hover:text-ink-dim">
              state on entry ({(event.input_snapshot_keys || []).length} keys)
            </summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {(event.input_snapshot_keys || []).map((k) => (
                <span
                  key={k}
                  className="rounded border border-chrome-border/60 bg-bg-raised/60 px-1.5 py-[1px] text-[10px] text-ink-dim"
                >
                  {k}
                </span>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// Pretty label for common state keys and richer rendering for known shapes.
const FRIENDLY_LABEL: Record<string, string> = {
  query: "query",
  primary_query: "cleaned query",
  queries: "search variants",
  sub_questions: "sub-questions (multi-hop split)",
  chat_history: "prior turns",
  answer: "answer",
  dense_results: "dense hits",
  bm25_results: "keyword hits (BM25)",
  code_bm25_results: "keyword hits (BM25)",
  fused_results: "after fusion",
  reranked_results: "after rerank",
  compressed_results: "after compression",
  graph_hits: "code-graph hits",
  focus_files: "focus files",
  code_intent: "code intent",
  complexity: "complexity",
  verdict: "grounding verdict",
  verify_reason: "verify reason",
  unsupported_claims: "unsupported claims",
  correction_attempts: "correction attempts",
  is_multihop: "multi-hop?",
  stored_chunk_count: "chunks stored",
  graph_symbols: "symbols indexed",
  graph_edges: "graph edges",
  head_sha: "commit sha",
};

function OutputField({ label, value }: { label: string; value: string }) {
  const pretty = FRIENDLY_LABEL[label] || label;
  const isLongList = value.includes("\n") && value.startsWith("list ");
  const isJson = value.startsWith("{") || value.startsWith("[");
  return (
    <div>
      <div className="mb-0.5 flex items-baseline gap-2">
        <span className="text-[10.5px] font-semibold text-mk-blue">{pretty}</span>
        {pretty !== label && (
          <span className="text-[9.5px] text-ink-faint">({label})</span>
        )}
      </div>
      <pre
        className={cn(
          "max-h-56 overflow-auto rounded border border-chrome-border/60 bg-bg/70 px-2 py-1.5 text-[10.5px] leading-snug text-ink whitespace-pre-wrap break-words",
          (isLongList || isJson) && "font-mono"
        )}
      >
        {value}
      </pre>
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Loader2, Database, Network, GitBranch, RefreshCw, Search,
  Home, ChevronRight, ArrowUpRight, ArrowDownLeft, ArrowLeftRight,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import {
  codeQueryApi,
  type GraphStats,
  type GraphSubgraph,
  type GraphSubgraphEdge,
  type GraphSubgraphNode,
} from "@/lib/rag";

interface Props {
  open: boolean;
  onClose: () => void;
  repoId: string;
  title?: string;
}

type Kind = "calls" | "imports";
type Direction = "out" | "in" | "both";

interface Pos { x: number; y: number; vx: number; vy: number }

const W = 900;
const H = 620;

export function KbBrowser({ open, onClose, repoId, title }: Props) {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [kind, setKind] = useState<Kind>("calls");
  const [limit, setLimit] = useState(120);
  const [graph, setGraph] = useState<GraphSubgraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState("");
  // Focus mode: when set, the canvas shows only this node + its neighbors.
  // Clicking another node swaps focus (auto-closing the previous one).
  const [focus, setFocus] = useState<GraphSubgraphNode | null>(null);
  const [direction, setDirection] = useState<Direction>("out");
  const [trail, setTrail] = useState<GraphSubgraphNode[]>([]);

  const loadStats = useCallback(async () => {
    try { setStats(await codeQueryApi.graphStats(repoId)); } catch { /* noop */ }
  }, [repoId]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    try {
      setGraph(await codeQueryApi.graphSubgraph(repoId, kind, limit));
    } catch (err) {
      if (err instanceof ApiError) console.warn(err.detail);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, [repoId, kind, limit]);

  const loadEgo = useCallback(async (node: GraphSubgraphNode) => {
    setLoading(true);
    setSelected(node.id);
    try {
      setGraph(await codeQueryApi.graphEgo(repoId, kind, node.id, direction, 50));
    } catch (err) {
      if (err instanceof ApiError) console.warn(err.detail);
      setGraph({ nodes: [node], edges: [] });
    } finally {
      setLoading(false);
    }
  }, [repoId, kind, direction]);

  // When kind/limit changes, drop focus and reload the overview.
  useEffect(() => {
    if (!open) return;
    loadStats();
    setFocus(null);
    setTrail([]);
    loadOverview();
  }, [open, kind, limit, loadStats, loadOverview]);

  // When focus/direction changes, load that node's neighborhood.
  useEffect(() => {
    if (!open || !focus) return;
    loadEgo(focus);
  }, [open, focus, direction, loadEgo]);

  function onNodeClick(node: GraphSubgraphNode) {
    if (focus?.id === node.id) return;
    if (focus) {
      // Swapping focus — push previous onto the breadcrumb.
      setTrail((t) => (t.length && t[t.length - 1].id === focus.id ? t : [...t, focus]));
    }
    setFocus(node);
  }

  function goHome() {
    setFocus(null);
    setTrail([]);
    loadOverview();
  }

  function goBack() {
    setTrail((t) => {
      const next = t.slice(0, -1);
      const prev = t[t.length - 1];
      if (prev) setFocus(prev);
      else { setFocus(null); loadOverview(); }
      return next;
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal>
      <button
        className="flex-1 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="close"
      />
      <aside className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-chrome-border bg-bg-soft/95 backdrop-blur-xl">
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

        <div className="flex flex-wrap items-center gap-2 border-b border-chrome-border/60 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
          <div className="flex gap-1">
            <Toggle active={kind === "calls"} onClick={() => setKind("calls")}>
              <Network className="h-3 w-3" /> calls
            </Toggle>
            <Toggle active={kind === "imports"} onClick={() => setKind("imports")}>
              <GitBranch className="h-3 w-3" /> imports
            </Toggle>
          </div>

          {!focus ? (
            <label className="ml-2 flex items-center gap-2 normal-case tracking-normal text-ink-faint">
              <span>top</span>
              <input
                type="range"
                min={20}
                max={300}
                step={10}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-32 accent-mk-green"
              />
              <span className="w-8 text-right text-ink">{limit}</span>
            </label>
          ) : (
            <div className="ml-2 flex items-center gap-1">
              <Toggle active={direction === "out"} onClick={() => setDirection("out")}>
                <ArrowDownLeft className="h-3 w-3" /> children
              </Toggle>
              <Toggle active={direction === "in"} onClick={() => setDirection("in")}>
                <ArrowUpRight className="h-3 w-3" /> parents
              </Toggle>
              <Toggle active={direction === "both"} onClick={() => setDirection("both")}>
                <ArrowLeftRight className="h-3 w-3" /> both
              </Toggle>
            </div>
          )}

          <div className="ml-2 flex items-center gap-1.5 rounded border border-chrome-border bg-bg-raised px-2 py-1 normal-case tracking-normal">
            <Search className="h-3 w-3 text-ink-faint" />
            <input
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
              placeholder="highlight…"
              className="w-40 bg-transparent text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>

          <button
            onClick={focus ? () => loadEgo(focus) : loadOverview}
            className="ml-auto inline-flex items-center gap-1 rounded border border-chrome-border px-2 py-1 hover:border-mk-green/50 hover:text-mk-green"
          >
            <RefreshCw className="h-3 w-3" /> refresh
          </button>
        </div>

        {focus && (
          <Breadcrumb
            trail={trail}
            focus={focus}
            onHome={goHome}
            onBack={goBack}
            onJump={(node, idx) => {
              setTrail((t) => t.slice(0, idx));
              setFocus(node);
            }}
          />
        )}

        <div className="relative flex-1 overflow-hidden bg-bg">
          {loading ? (
            <div className="flex h-full items-center justify-center font-mono text-[11.5px] text-ink-dim">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              building layout…
            </div>
          ) : graph && graph.nodes.length ? (
            <ForceGraph
              graph={graph}
              selected={selected}
              onSelect={setSelected}
              onExpand={onNodeClick}
              highlight={highlight}
              kind={kind}
              focusId={focus?.id ?? null}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center font-mono text-[11.5px] text-ink-faint">
              {kind === "calls"
                ? "no CALLS edges in the graph yet."
                : "no IMPORTS edges in the graph yet."}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ForceGraph({
  graph,
  selected,
  onSelect,
  onExpand,
  highlight,
  kind,
  focusId,
}: {
  graph: GraphSubgraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onExpand: (node: GraphSubgraphNode) => void;
  highlight: string;
  kind: Kind;
  focusId: string | null;
}) {
  const positions = useLayout(graph);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragId = useRef<string | null>(null);
  const dragOff = useRef({ x: 0, y: 0 });
  const panning = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, force] = useState(0); // for re-renders while dragging

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    for (const e of graph.edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [graph.edges, selected]);

  const hi = highlight.trim().toLowerCase();

  function nodeScreenPoint(e: React.PointerEvent) {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    return ctm ? pt.matrixTransform(ctm) : { x: 0, y: 0 };
  }

  function toGraphCoords(sx: number, sy: number) {
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }

  const selectedNode = selected ? graph.nodes.find((n) => n.id === selected) : null;

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full touch-none select-none"
        onWheel={(e) => {
          e.preventDefault();
          const p = nodeScreenPoint(e as unknown as React.PointerEvent);
          const g = toGraphCoords(p.x, p.y);
          const nextK = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          setView({ k: nextK, x: p.x - g.x * nextK, y: p.y - g.y * nextK });
        }}
        onPointerDown={(e) => {
          const p = nodeScreenPoint(e);
          panning.current = { x: p.x - view.x, y: p.y - view.y };
        }}
        onPointerMove={(e) => {
          if (dragId.current) {
            const p = nodeScreenPoint(e);
            const g = toGraphCoords(p.x, p.y);
            const pos = positions.get(dragId.current)!;
            pos.x = g.x - dragOff.current.x;
            pos.y = g.y - dragOff.current.y;
            pos.vx = pos.vy = 0;
            force((n) => n + 1);
            return;
          }
          if (panning.current) {
            const p = nodeScreenPoint(e);
            setView((v) => ({ ...v, x: p.x - panning.current!.x, y: p.y - panning.current!.y }));
          }
        }}
        onPointerUp={() => { dragId.current = null; panning.current = null; }}
        onPointerLeave={() => { dragId.current = null; panning.current = null; }}
        onClick={(e) => { if (e.target === svgRef.current) onSelect(null); }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((e, i) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            const dim = selected && !(e.source === selected || e.target === selected);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={1 / view.k}
                className={cn(
                  "text-chrome-border/60",
                  dim ? "opacity-15" : "opacity-70",
                  e.source === selected && "text-mk-yellow opacity-90",
                  e.target === selected && "text-mk-purple opacity-90",
                )}
                stroke="currentColor"
                markerEnd="url(#arrow)"
              />
            );
          })}

          {graph.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const r = 4 + Math.sqrt(n.degree) * 2.2;
            const isSel = selected === n.id;
            const isN = neighbors.has(n.id);
            const isMatch = hi && n.label.toLowerCase().includes(hi);
            const dim = (selected && !isSel && !isN) || (hi && !isMatch);
            const fill = kindColor(kind, n.kind);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  panning.current = null;
                  const sp = nodeScreenPoint(e);
                  const gp = toGraphCoords(sp.x, sp.y);
                  dragOff.current = { x: gp.x - p.x, y: gp.y - p.y };
                  dragId.current = n.id;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n.id);
                  onExpand(n);
                }}
                className="cursor-pointer"
              >
                <circle
                  r={n.id === focusId ? r + 3 : r}
                  fill={fill}
                  strokeWidth={
                    n.id === focusId ? 2.5 / view.k
                      : isSel ? 2 / view.k
                      : isMatch ? 1.5 / view.k
                      : 0.75 / view.k
                  }
                  stroke={
                    n.id === focusId ? "#facc15"
                      : isSel ? "#fff"
                      : isMatch ? "#facc15"
                      : "#0b0b0f"
                  }
                  opacity={dim ? 0.2 : 0.95}
                />
                {(n.id === focusId || isSel || isN || isMatch || view.k > 1.1 || focusId) && (
                  <text
                    x={r + 3}
                    y={3}
                    fontSize={(n.id === focusId ? 12 : 10) / view.k}
                    className="pointer-events-none fill-current font-mono text-ink"
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-ink-faint">
        {graph.nodes.length} nodes · {graph.edges.length} edges · click node to expand · scroll = zoom · drag = pan / move
      </div>

      {selectedNode && (
        <div className="absolute bottom-2 right-2 max-w-sm rounded border border-chrome-border bg-bg-soft/95 p-3 font-mono text-[11.5px] shadow-block backdrop-blur">
          <p className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: kindColor(kind, selectedNode.kind) }}
            />
            <span className="text-mk-pink">{selectedNode.label}</span>
            <span className="text-[10px] text-ink-faint">({selectedNode.kind})</span>
          </p>
          {selectedNode.file && (
            <p className="mt-0.5 truncate text-[10.5px] text-ink-dim" title={selectedNode.file}>
              {selectedNode.file}
            </p>
          )}
          <p className="mt-1 text-[10px] text-ink-faint">
            degree <span className="text-ink">{selectedNode.degree}</span>
            {" · "}
            neighbors <span className="text-ink">{neighbors.size}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// -------- layout ----------------------------------------------------------

function useLayout(graph: GraphSubgraph) {
  return useMemo(() => {
    const positions = new Map<string, Pos>();
    const n = graph.nodes.length;
    if (n === 0) return positions;

    // Seed on a circle so we don't start from a singularity.
    const cx = W / 2, cy = H / 2;
    const r0 = Math.min(W, H) * 0.35;
    graph.nodes.forEach((node, i) => {
      const a = (i / n) * Math.PI * 2;
      positions.set(node.id, {
        x: cx + r0 * Math.cos(a),
        y: cy + r0 * Math.sin(a),
        vx: 0, vy: 0,
      });
    });

    // Fruchterman-Reingold-ish. Iteration count scales down with node count.
    const area = W * H;
    const k = Math.sqrt(area / n) * 0.7;
    const iters = Math.max(80, Math.min(220, Math.round(2400 / Math.sqrt(n))));
    let temp = Math.min(W, H) * 0.15;
    const cooling = temp / iters;

    const edges = graph.edges.filter(
      (e) => positions.has(e.source) && positions.has(e.target),
    );

    for (let step = 0; step < iters; step++) {
      // Repulsion: O(n^2). Fine for n<=300.
      const arr = Array.from(positions.values());
      const ids = Array.from(positions.keys());
      for (let i = 0; i < arr.length; i++) {
        arr[i].vx = 0;
        arr[i].vy = 0;
      }
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          let dx = arr[i].x - arr[j].x;
          let dy = arr[i].y - arr[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random(); dy = Math.random(); d2 = dx * dx + dy * dy; }
          const d = Math.sqrt(d2);
          const rep = (k * k) / d;
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          arr[i].vx += fx; arr[i].vy += fy;
          arr[j].vx -= fx; arr[j].vy -= fy;
        }
      }
      // Attraction along edges
      for (const e of edges) {
        const a = positions.get(e.source)!;
        const b = positions.get(e.target)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const att = (d * d) / k;
        const fx = (dx / d) * att;
        const fy = (dy / d) * att;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
      // Apply, cap by temperature, clamp to canvas.
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 0.01;
        p.x += (p.vx / speed) * Math.min(speed, temp);
        p.y += (p.vy / speed) * Math.min(speed, temp);
        p.x = Math.max(20, Math.min(W - 20, p.x));
        p.y = Math.max(20, Math.min(H - 20, p.y));
        void ids;
      }
      temp = Math.max(0.5, temp - cooling);
    }
    return positions;
  }, [graph]);
}

function kindColor(view: Kind, kind: string): string {
  if (view === "imports") {
    switch (kind) {
      case "python": return "#22c55e";
      case "typescript":
      case "javascript":
      case "tsx":
      case "jsx": return "#38bdf8";
      case "go": return "#06b6d4";
      case "rust": return "#f97316";
      case "java": return "#f59e0b";
      default: return "#a78bfa";
    }
  }
  switch (kind) {
    case "function":
    case "method": return "#22c55e";
    case "class": return "#38bdf8";
    case "variable": return "#facc15";
    default: return "#a78bfa";
  }
}

// -------- surrounding widgets --------------------------------------------

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

function Breadcrumb({
  trail, focus, onHome, onBack, onJump,
}: {
  trail: GraphSubgraphNode[];
  focus: GraphSubgraphNode;
  onHome: () => void;
  onBack: () => void;
  onJump: (node: GraphSubgraphNode, idx: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-chrome-border/60 bg-chrome/40 px-3 py-1.5 font-mono text-[10.5px] text-ink-dim">
      <button
        onClick={onHome}
        className="inline-flex items-center gap-1 rounded border border-chrome-border px-1.5 py-0.5 hover:border-mk-green/50 hover:text-mk-green"
        title="back to top-N overview"
      >
        <Home className="h-3 w-3" /> overview
      </button>
      {trail.length > 0 && (
        <>
          <ChevronRight className="h-3 w-3 text-ink-faint" />
          <button
            onClick={onBack}
            className="rounded border border-chrome-border px-1.5 py-0.5 hover:text-ink"
            title="back one step"
          >
            ← back
          </button>
        </>
      )}
      {trail.map((node, i) => (
        <span key={`${node.id}-${i}`} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-ink-faint" />
          <button
            onClick={() => onJump(node, i)}
            className="truncate rounded px-1 py-0.5 text-ink-dim hover:text-mk-pink"
            title={node.file || undefined}
          >
            {node.label}
          </button>
        </span>
      ))}
      <ChevronRight className="h-3 w-3 text-ink-faint" />
      <span className="rounded bg-mk-yellow/10 px-1.5 py-0.5 text-mk-yellow">
        {focus.label}
      </span>
    </div>
  );
}

function Toggle({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-1",
        active
          ? "border-mk-green/50 bg-mk-green/10 text-mk-green"
          : "border-chrome-border text-ink-dim hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// unused helpers kept for typing symmetry
export type { GraphSubgraphNode, GraphSubgraphEdge };

export function KbButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-chrome-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim hover:border-mk-green/50 hover:text-mk-green"
      title="graph kb visualizer"
    >
      <Database className="h-3 w-3" />
      kb
    </button>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, MessageSquare, ShieldCheck, Terminal, Wifi, Cpu, Github, GitBranch } from "lucide-react";
import { MatrixRain } from "@/components/matrix-rain";

function useClock() {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function randHex(n: number) {
  let s = "";
  const chars = "0123456789ABCDEF";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function useRotatingHex(len = 6, everyMs = 1200) {
  const [v, setV] = useState(() => randHex(len));
  useEffect(() => {
    const id = setInterval(() => setV(randHex(len)), everyMs);
    return () => clearInterval(id);
  }, [len, everyMs]);
  return v;
}

const LOG_LINES = [
  "[ ok ] handshake accepted — TLS 1.3 · X25519",
  "[ ok ] vector index warm · 128,441 embeddings",
  "[ ok ] retriever online · reranker=bge-v2",
  "[ ok ] kuzu code-graph loaded · 42,318 symbols",
  "[warn] rate-limit soft cap · 60 req/min",
  "[ ok ] llm pool ready · groq · gemini · cerebras · openrouter",
  "[ ok ] tree-sitter · py+ts+go+java+rust parsed",
  "[ ok ] rag pipeline nominal — mean lat 214ms",
  "[ ok ] repo ingest worker idle · queue=0",
  "[ ok ] session bus connected — evt/s = 0.4",
  "[warn] tokenizer cache miss ratio 3.1%",
  "[ ok ] auth bridge online — jwt · rs256",
];

function LogFeed() {
  const [lines, setLines] = useState<string[]>(LOG_LINES.slice(0, 3));
  useEffect(() => {
    let i = 3;
    const id = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, LOG_LINES[i % LOG_LINES.length]];
        i++;
        return next.slice(-3);
      });
    }, 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-3 rounded border border-chrome-border bg-bg/70 px-2.5 py-1.5 font-mono text-[10.5px] leading-tight">
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.22em] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_currentColor] animate-pulse" />
          tail -f /var/log/lumen.sys
        </span>
        <span className="text-mk-green">STREAMING</span>
      </div>
      <div className="space-y-0">
        {lines.map((l, i) => (
          <div
            key={`${l}-${i}`}
            className={
              "truncate " +
              (l.startsWith("[warn]") ? "text-mk-yellow" : "text-ink-dim") +
              (i === lines.length - 1 ? " text-ink" : "")
            }
          >
            <span className="text-mk-comment">{new Date().toISOString().slice(11, 19)} </span>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  mode = "login",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  mode?: "login" | "signup";
}) {
  const now = useClock();
  const sess = useRotatingHex(10, 1600);
  const node = useRotatingHex(4, 4000);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-4 lg:py-6">
      {/* ============ ambient backdrop ============ */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <MatrixRain opacity={0.28} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 hacker-grid opacity-40" />
      <div aria-hidden className="pointer-events-none absolute inset-0 warp-ambient" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-scanline opacity-40 mix-blend-overlay"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 crt-vignette" />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="scan-line" />
      </div>

      {/* ============ top HUD bar ============ */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
        <div className="flex items-center gap-2">
          <span className="hud-chip"><span className="k">node</span><span className="v pink">lumen-{node}</span></span>
          <span className="hud-chip hidden sm:inline-flex"><span className="k">region</span><span className="v">iad-1</span></span>
          <span className="hud-chip hidden md:inline-flex"><span className="k">build</span><span className="v blue">v0.2.7</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hud-chip hidden sm:inline-flex"><span className="k">sess</span><span className="v blue">0x{sess}</span></span>
          <span className="hud-chip"><span className="k">utc</span><span className="v">{now}</span></span>
        </div>
      </div>

      {/* ============ caution stripe borders (top+bottom) ============ */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[3px] caution-stripes opacity-70" />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 h-[3px] caution-stripes opacity-70" />

      <div className="relative z-10 grid w-full max-w-5xl animate-slide-up gap-6 lg:grid-cols-[1.05fr_1fr]">
        {/* LEFT — brand / features / log */}
        <div className="hidden flex-col justify-center px-2 lg:flex">
          <Link
            href="/"
            className="mb-4 flex items-center gap-2 font-mono text-[13px] tracking-tight text-ink"
          >
            <span className="text-prompt drop-shadow-[0_0_8px_rgba(249,38,114,0.8)]">◆</span>
            <span className="font-bold neon-text">LUMEN</span>
            <span className="text-ink-faint">·</span>
            <span className="text-ink-dim">v0.2</span>
            <span className="ml-2 hud-chip"><span className="k">env</span><span className="v">prod</span></span>
          </Link>

          <h2 className="font-mono text-[30px] font-black leading-[1.08] text-ink">
            <span className="glitch" data-text="grep your">grep your</span>{" "}
            <span className="glitch neon-text" data-text="/docs">
              /docs
            </span>
            <span className="text-ink-faint"> + </span>
            <span className="glitch text-mk-blue" data-text="/code" style={{ textShadow: "0 0 8px rgb(var(--c-mk-blue) / 0.6)" }}>
              /code
            </span>
            <span className="text-ink-faint">_</span>
          </h2>
          <p className="mt-3 max-w-md font-mono text-[13px] leading-snug text-ink-dim">
            <span className="text-mk-green">$</span> upload PDFs & docs or clone a GitHub repo — lumen finds the right
            passages, symbols, and call-graphs, and answers with citations.
          </p>

          <ul className="mt-4 space-y-2 font-mono text-[12.5px]">
            <Feature
              icon={<FileText className="h-4 w-4 text-mk-blue" />}
              tag="INGEST"
              title="drop in any document"
              desc="pdf, docx, markdown, txt — up to 50 MB"
            />
            <Feature
              icon={<Github className="h-4 w-4 text-mk-yellow" />}
              tag="CLONE"
              title="index whole github repos"
              desc="tree-sitter · symbols · call-graph via kuzu"
            />
            <Feature
              icon={<MessageSquare className="h-4 w-4 text-mk-pink" />}
              tag="QUERY"
              title="ask in plain english"
              desc="answers with exact passages & file refs cited"
            />
            <Feature
              icon={<GitBranch className="h-4 w-4 text-mk-purple" />}
              tag="ROUTE"
              title="5 llm providers, auto-failover"
              desc="groq · gemini · cerebras · openrouter · openai"
            />
            <Feature
              icon={<ShieldCheck className="h-4 w-4 text-mk-green" />}
              tag="ISOLATE"
              title="your workspace, your data"
              desc="docs & repos only reachable from your account"
            />
          </ul>

          <LogFeed />
        </div>

        {/* RIGHT — auth terminal */}
        <div className="relative bracket-frame">
          <span className="bracket-corner" />
          <div className="terminal-frame overflow-hidden rounded-md backdrop-blur">
            {/* window header */}
            <div className="relative flex h-9 items-center gap-2 border-b border-chrome-border bg-chrome px-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-mk-pink/90 shadow-[0_0_6px_currentColor]" />
                <span className="h-2.5 w-2.5 rounded-full bg-mk-yellow/90 shadow-[0_0_6px_currentColor]" />
                <span className="h-2.5 w-2.5 rounded-full bg-mk-green/90 shadow-[0_0_6px_currentColor]" />
              </div>
              <div className="flex-1 text-center font-mono text-[10.5px] tracking-[0.22em] text-ink-faint">
                <span className="text-prompt">◆</span> lumen@auth ~ /{" "}
                <span className="text-ink-dim">{mode === "signup" ? "register" : "login"}.sh</span>
              </div>
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.2em]">
                <span className="h-1.5 w-1.5 rounded-full bg-mk-green shadow-[0_0_6px_currentColor] animate-pulse" />
                <span className="text-mk-green">SECURE</span>
              </span>
            </div>

            {/* mobile-only brand */}
            <div className="border-b border-chrome-border bg-chrome/40 px-6 py-3 text-center lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2 font-mono text-[13px] tracking-tight text-ink">
                <span className="text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.7)]">◆</span>
                <span className="font-bold neon-text">LUMEN</span>
              </Link>
            </div>

            {/* status strip */}
            <div className="flex items-center justify-between gap-2 border-b border-chrome-border bg-bg/60 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <Terminal className="h-3 w-3 text-mk-green" />
                <span className="text-mk-green">tls</span>
                <span className="text-ink-dim">1.3</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Wifi className="h-3 w-3 text-mk-blue" />
                <span className="text-mk-blue">ping</span>
                <span className="text-ink-dim">18ms</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-mk-yellow" />
                <span className="text-mk-yellow">llm</span>
                <span className="text-ink-dim">ready</span>
              </span>
            </div>

            <div className="relative px-5 py-5">
              <div className="mb-4">
                <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ink-faint">
                  <span className="text-mk-green">$</span> sudo auth --{mode === "signup" ? "register" : "login"}
                </div>
                <h1
                  className="glitch font-mono text-[23px] font-black tracking-tight text-ink"
                  data-text={title}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-1 font-mono text-[12.5px] text-ink-dim">
                    <span className="text-mk-comment"># </span>
                    {subtitle}
                  </p>
                )}
              </div>

              {children}
            </div>

            {footer && (
              <div className="border-t border-chrome-border bg-chrome/60 px-6 py-3 text-center font-mono text-[12px] text-ink-dim">
                {footer}
              </div>
            )}

            <div className="border-t border-chrome-border bg-chrome/40 px-6 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-ink-faint">
              <span className="text-mk-green">●</span> connection encrypted
              <span className="mx-2 text-ink-faint">·</span>
              zero-knowledge
              <span className="mx-2 text-ink-faint">·</span>
              <span className="text-mk-blue">sess 0x{sess}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
  tag,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tag: string;
}) {
  return (
    <li className="group flex items-start gap-2.5 rounded border border-transparent px-1.5 py-1 transition-colors hover:border-chrome-border hover:bg-bg-soft/40">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-chrome-border bg-bg-soft shadow-[0_0_10px_-4px_rgb(var(--c-prompt)/0.5)] transition-shadow group-hover:shadow-[0_0_16px_-2px_rgb(var(--c-prompt)/0.7)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-ink">{title}</span>
          <span className="rounded-sm border border-chrome-border bg-bg px-1 text-[9px] uppercase tracking-[0.2em] text-mk-comment">
            {tag}
          </span>
        </div>
        <div className="text-[11.5px] leading-snug text-ink-dim">{desc}</div>
      </div>
    </li>
  );
}

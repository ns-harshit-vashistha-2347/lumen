"use client";

import Link from "next/link";
import { FileText, MessageSquare, ShieldCheck } from "lucide-react";

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
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 warp-ambient" />
      <div aria-hidden className="pointer-events-none absolute inset-0 warp-grid opacity-[0.3]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-scanline opacity-30 mix-blend-overlay"
      />

      <div className="relative z-10 grid w-full max-w-4xl animate-slide-up gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* LEFT — welcome / features */}
        <div className="hidden flex-col justify-center px-2 lg:flex">
          <Link
            href="/"
            className="mb-4 flex items-center gap-2 font-mono text-[13px] tracking-tight text-ink"
          >
            <span className="text-prompt drop-shadow-[0_0_6px_rgba(249,38,114,0.6)]">◆</span>
            <span className="font-bold">lumen</span>
            <span className="text-ink-faint">·</span>
            <span className="text-ink-dim">v0.2</span>
          </Link>

          <h2 className="font-mono text-[26px] font-bold leading-tight text-ink">
            chat with your{" "}
            <span className="text-prompt drop-shadow-[0_0_8px_rgba(249,38,114,0.35)]">
              documents
            </span>
            .
          </h2>
          <p className="mt-3 max-w-sm font-mono text-[13px] leading-relaxed text-ink-dim">
            upload PDFs, docs, and notes — then ask questions across them. lumen finds the
            right passages and answers with citations.
          </p>

          <ul className="mt-6 space-y-3 font-mono text-[12.5px]">
            <Feature
              icon={<FileText className="h-4 w-4 text-mk-blue" />}
              title="drop in any document"
              desc="pdf, docx, markdown, txt — up to 50 MB each"
            />
            <Feature
              icon={<MessageSquare className="h-4 w-4 text-mk-pink" />}
              title="ask in plain english"
              desc="get answers with the exact source passages cited"
            />
            <Feature
              icon={<ShieldCheck className="h-4 w-4 text-mk-green" />}
              title="your workspace, your data"
              desc="documents only reachable from your own account"
            />
          </ul>
        </div>

        {/* RIGHT — auth form */}
        <div className="overflow-hidden rounded-lg border border-chrome-border bg-bg-soft/90 shadow-term backdrop-blur">
          {/* window header */}
          <div className="flex h-9 items-center gap-2 border-b border-chrome-border bg-chrome px-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-mk-pink/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-mk-yellow/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-mk-green/90" />
            </div>
            <div className="flex-1 text-center font-mono text-[10.5px] tracking-[0.14em] text-ink-faint">
              {mode === "signup" ? "create account" : "sign in"}
            </div>
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em]">
              <span className="h-1.5 w-1.5 rounded-full bg-mk-green shadow-[0_0_6px_currentColor] animate-pulse" />
              <span className="text-mk-green">secure</span>
            </span>
          </div>

          {/* mobile-only brand */}
          <div className="border-b border-chrome-border bg-chrome/40 px-6 py-3 text-center lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2 font-mono text-[13px] tracking-tight text-ink">
              <span className="text-prompt">◆</span>
              <span className="font-bold">lumen</span>
            </Link>
          </div>

          <div className="p-6">
            <div className="mb-5">
              <h1 className="font-mono text-[22px] font-bold tracking-tight text-ink">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1 font-mono text-[12.5px] text-ink-dim">{subtitle}</p>
              )}
            </div>

            {children}
          </div>

          {footer && (
            <div className="border-t border-chrome-border bg-chrome/60 px-6 py-3 text-center font-mono text-[12px] text-ink-dim">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-chrome-border bg-bg-soft">
        {icon}
      </span>
      <div>
        <div className="text-ink">{title}</div>
        <div className="text-[11.5px] text-ink-dim">{desc}</div>
      </div>
    </li>
  );
}

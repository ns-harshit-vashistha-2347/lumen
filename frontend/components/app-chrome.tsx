"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, ChevronDown } from "lucide-react";

function LiveStatus() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mr-2 hidden items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint md:flex">
      <span className="flex items-end gap-[2px]" title="signal">
        <span className="h-1 w-[3px] bg-ok/80" />
        <span className="h-2 w-[3px] bg-ok/80" />
        <span className="h-3 w-[3px] bg-ok" />
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_currentColor] animate-pulse" />
        <span className="text-ok">secure</span>
      </span>
      <span className="text-ink">{now}</span>
    </div>
  );
}

import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const TABS = [
  { href: "/chat", label: "chat" },
  { href: "/documents", label: "library" },
  { href: "/code-playground", label: "code" },
];

export function AppChrome() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const activeTab = TABS.find((t) => pathname.startsWith(t.href))?.label ?? "chat";
  const initials =
    (user?.full_name || user?.email || "?")
      .split(/[\s@]+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-chrome-border bg-chrome/90 backdrop-blur-xl">
      <div className="flex h-11 items-center gap-3 px-3">
        {/* traffic-light dots */}
        <div className="flex items-center gap-1.5 pl-1">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/80" />
        </div>

        {/* brand + path */}
        <div className="ml-2 flex items-center gap-2 font-mono text-[11.5px] tracking-tight text-ink-dim">
          <span className="text-prompt">◆</span>
          <span className="text-ink">lumen</span>
          <span className="text-ink-faint">·</span>
          <span className="text-prompt">▸</span>
          <span className="text-ink">{activeTab}</span>
        </div>

        {/* tabs */}
        <nav className="ml-4 hidden items-center gap-1 sm:flex">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "rounded-md px-2.5 py-1 font-mono text-[11.5px] tracking-tight transition-colors",
                  active
                    ? "bg-prompt/15 text-prompt"
                    : "text-ink-dim hover:bg-chrome-hover hover:text-ink"
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* theme toggle */}
        <ThemeToggle />

        {/* command palette hint */}
        <button
          onClick={() => window.dispatchEvent(new Event("lumen:palette"))}
          className="hidden items-center gap-1.5 rounded-md border border-chrome-border bg-chrome-hover/40 px-2 py-1 font-mono text-[10.5px] text-ink-dim hover:border-prompt/40 hover:text-ink md:inline-flex"
        >
          <span>quick jump</span>
          <kbd className="rounded border border-chrome-border bg-bg px-1 text-[9.5px] text-mk-yellow">⌘K</kbd>
        </button>

        {/* live status readout */}
        <LiveStatus />

        {/* session / user */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-chrome-border bg-chrome-hover/60 py-1 pl-1 pr-2 text-[11.5px] font-mono text-ink hover:border-prompt/40"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-prompt/20 text-[9.5px] font-semibold text-prompt">
              {initials || "·"}
            </span>
            <span className="hidden max-w-[140px] truncate sm:inline">
              {user?.email ?? "session"}
            </span>
            <ChevronDown className="h-3 w-3 text-ink-dim" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-56 rounded-md border border-chrome-border bg-chrome shadow-block animate-slide-up">
              <div className="border-b border-chrome-border px-3 py-2">
                <p className="truncate text-xs font-medium text-ink">
                  {user?.full_name || user?.email}
                </p>
                <p className="truncate font-mono text-[10.5px] text-ink-dim">
                  {user?.email}
                </p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11.5px] text-ink-muted hover:bg-chrome-hover hover:text-danger"
              >
                <LogOut className="h-3.5 w-3.5" />
                sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* mobile tabs row */}
      <div className="flex items-center gap-1 border-t border-chrome-border/50 px-3 py-1.5 sm:hidden">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-center font-mono text-[11px] tracking-tight",
                active
                  ? "bg-prompt/15 text-prompt"
                  : "text-ink-dim hover:bg-chrome-hover"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

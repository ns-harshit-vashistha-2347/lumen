"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  FolderOpen,
  Upload,
  LogOut,
  X,
  Search,
  FileText,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { docsApi, type Document } from "@/lib/rag";
import { ApiError } from "@/lib/api";
import { useScope } from "@/lib/scope-store";
import { useAuth } from "@/components/auth/auth-provider";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  section: "nav" | "action" | "doc";
  icon: React.ReactNode;
  run: () => void;
  keywords?: string;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [docs, setDocs] = useState<Document[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [scope, store] = useScope();
  const { logout } = useAuth();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    function onCustom() {
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("lumen:palette", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lumen:palette", onCustom);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setI(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    docsApi
      .list()
      .then(setDocs)
      .catch((err) => {
        if (!(err instanceof ApiError)) throw err;
      });
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const commands = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      {
        id: "nav-chat",
        label: "go to chat",
        hint: "/chat",
        section: "nav",
        icon: <MessageSquare className="h-3.5 w-3.5 text-mk-pink" />,
        run: () => {
          router.push("/chat");
          close();
        },
      },
      {
        id: "nav-lib",
        label: "open library",
        hint: "/documents",
        section: "nav",
        icon: <FolderOpen className="h-3.5 w-3.5 text-mk-blue" />,
        run: () => {
          router.push("/documents");
          close();
        },
      },
      {
        id: "nav-code",
        label: "open code playground",
        hint: "/code-playground",
        section: "nav",
        icon: <Zap className="h-3.5 w-3.5 text-mk-yellow" />,
        keywords: "repos github codebase",
        run: () => {
          router.push("/code-playground");
          close();
        },
      },
      {
        id: "act-upload",
        label: "upload documents",
        hint: "jump to library",
        section: "action",
        icon: <Upload className="h-3.5 w-3.5 text-mk-green" />,
        keywords: "add new file drop",
        run: () => {
          router.push("/documents");
          close();
        },
      },
      {
        id: "act-clear-scope",
        label: `clear chat scope (${scope.size})`,
        hint: "unselect all documents",
        section: "action",
        icon: <X className="h-3.5 w-3.5 text-mk-yellow" />,
        run: () => {
          store.set([]);
          close();
        },
      },
      {
        id: "act-logout",
        label: "sign out",
        hint: "end session",
        section: "action",
        icon: <LogOut className="h-3.5 w-3.5 text-danger" />,
        keywords: "logout exit quit",
        run: () => {
          close();
          logout();
        },
      },
    ];

    const docCmds: Cmd[] = docs
      .filter((d) => d.status === "completed")
      .slice(0, 30)
      .map((d) => ({
        id: `doc-${d.id}`,
        label: d.filename,
        hint: scope.has(d.id) ? "in scope · remove" : "add to scope",
        section: "doc",
        icon: <FileText className="h-3.5 w-3.5 text-mk-purple" />,
        run: () => {
          store.toggle(d.id);
        },
      }));

    return [...base, ...docCmds];
  }, [docs, scope, router, store, logout, close]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((c) =>
      (c.label + " " + (c.hint || "") + " " + (c.keywords || ""))
        .toLowerCase()
        .includes(query)
    );
  }, [commands, q]);

  useEffect(() => {
    if (i >= filtered.length) setI(0);
  }, [filtered.length, i]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((v) => Math.min(filtered.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[i]?.run();
    }
  }

  if (!open) return null;

  const grouped = {
    nav: filtered.filter((c) => c.section === "nav"),
    action: filtered.filter((c) => c.section === "action"),
    doc: filtered.filter((c) => c.section === "doc"),
  };

  let flatIdx = -1;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]">
      <div
        onClick={close}
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm animate-fade-in"
      />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-md border border-chrome-border bg-bg-soft shadow-term animate-slide-up"
        onKeyDown={onKey}
      >
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-chrome-border bg-chrome px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-mk-pink/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-mk-yellow/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-mk-green/90" />
          </div>
          <div className="flex-1 text-center font-mono text-[10.5px] tracking-[0.16em] text-ink-faint">
            — lumen · command palette —
          </div>
          <span className="font-mono text-[9.5px] tracking-[0.14em] text-ink-faint">
            esc
          </span>
        </div>

        {/* search */}
        <div className="flex items-center gap-2 border-b border-chrome-border bg-bg-raised px-3 py-2.5">
          <Search className="h-4 w-4 text-mk-pink" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            placeholder="type a command, or search your docs…"
            className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <span className="flex items-center gap-1 font-mono text-[9.5px] tracking-[0.14em] text-ink-faint">
            <kbd className="rounded border border-chrome-border bg-bg px-1 text-mk-yellow">↑↓</kbd>
            <kbd className="rounded border border-chrome-border bg-bg px-1 text-mk-yellow">↵</kbd>
          </span>
        </div>

        {/* list */}
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[12px] text-mk-comment">
              <span className="text-mk-pink">$</span> no match — try different keywords
            </div>
          ) : (
            (["nav", "action", "doc"] as const).map((s) => {
              const list = grouped[s];
              if (list.length === 0) return null;
              const label =
                s === "nav" ? "navigate" : s === "action" ? "actions" : "documents";
              return (
                <div key={s} className="mb-1">
                  <div className="px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-mk-comment">
                    <Zap className="mr-1 inline h-2.5 w-2.5 text-mk-pink" /> {label}
                  </div>
                  {list.map((c) => {
                    flatIdx++;
                    const active = flatIdx === i;
                    return (
                      <button
                        key={c.id}
                        onClick={c.run}
                        onMouseEnter={() => setI(flatIdx)}
                        className={cn(
                          "group flex w-full items-center gap-3 border-l-2 px-3 py-1.5 text-left font-mono text-[12.5px] transition-colors",
                          active
                            ? "border-l-mk-pink bg-line/70 text-ink"
                            : "border-l-transparent text-ink-dim hover:bg-line/40"
                        )}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-chrome-border bg-bg">
                          {c.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.hint && (
                          <span className="hidden text-[10.5px] text-mk-comment sm:inline">
                            {c.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-chrome-border bg-chrome px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mk-comment">
          <span>
            <span className="text-mk-green">▸</span> {filtered.length} results
          </span>
          <span>
            <kbd className="mr-1 rounded border border-chrome-border bg-bg-soft px-1 text-mk-yellow">
              ⌘ K
            </kbd>
            toggle
          </span>
        </div>
      </div>
    </div>
  );
}

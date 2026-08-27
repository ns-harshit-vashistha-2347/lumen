"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, MessageSquare, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import {
  chatSessionsApi,
  type ChatKind,
  type ChatSession,
} from "@/lib/chat-history";

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ChatKind;
  repoId?: string;         // required for kind=code
  currentSessionId: string | null;
  onSelect: (id: string | null) => void;   // null = new session (start fresh)
}

export function SessionSidebar({
  open,
  onClose,
  kind,
  repoId,
  currentSessionId,
  onSelect,
}: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await chatSessionsApi.list({ kind, repo_id: repoId });
        if (!cancelled) setSessions(list);
      } catch (err) {
        if (err instanceof ApiError) toast.error(err.detail);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, repoId]);

  async function del(id: string) {
    if (!confirm("delete this conversation?")) return;
    try {
      await chatSessionsApi.del(id);
      setSessions((s) => s.filter((x) => x.id !== id));
      if (currentSessionId === id) onSelect(null);
      toast.success("deleted");
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.detail);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-chrome-border bg-bg-soft/95 shadow-block backdrop-blur">
      <div className="flex items-center justify-between border-b border-chrome-border px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-dim">
        <span className="flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 text-mk-blue" />
          conversations
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-ink-faint hover:bg-chrome-hover hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        onClick={() => onSelect(null)}
        className="mx-3 mt-2 inline-flex items-center gap-1.5 rounded border border-chrome-border bg-gradient-to-b from-prompt to-prompt-soft px-2 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[#1a0410] shadow-glow hover:brightness-110"
      >
        <Plus className="h-3 w-3" />
        new chat
      </button>

      <div className="mt-2 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 font-mono text-[11px] text-ink-dim">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-4 font-mono text-[11px] text-ink-faint">
            no conversations yet
          </div>
        ) : (
          <ul className="space-y-0.5 py-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 px-2",
                    currentSessionId === s.id && "bg-prompt/10"
                  )}
                >
                  <button
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "flex-1 truncate rounded px-1.5 py-1 text-left font-mono text-[12px]",
                      currentSessionId === s.id
                        ? "text-prompt"
                        : "text-ink hover:text-ink-dim"
                    )}
                    title={s.title}
                  >
                    <span className="truncate">{s.title || "untitled"}</span>
                  </button>
                  <button
                    onClick={() => del(s.id)}
                    className="rounded p-1 text-ink-faint opacity-0 hover:text-danger group-hover:opacity-100"
                    title="delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SidebarToggle({
  onClick,
  count,
}: {
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      title="conversations"
      className="inline-flex items-center gap-1 rounded border border-chrome-border bg-bg-raised/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim hover:border-mk-blue/40 hover:text-mk-blue"
    >
      <MessageSquare className="h-3 w-3" />
      history
      {typeof count === "number" && <span className="text-mk-blue">{count}</span>}
    </button>
  );
}

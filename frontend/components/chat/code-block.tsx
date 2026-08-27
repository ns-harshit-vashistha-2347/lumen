"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { detectLangFromClassName, highlight } from "@/lib/highlight";
import { cn } from "@/lib/cn";

function childrenToString(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (children && typeof children === "object" && "props" in children) {
    // @ts-expect-error react markdown node
    return childrenToString(children.props.children);
  }
  return "";
}

// Inline `code` (single backticks inside a paragraph)
export function InlineCode({ children }: { children?: ReactNode }) {
  return (
    <code className="rounded bg-bg-raised/70 px-1 py-[1px] font-mono text-[12px] text-mk-yellow">
      {children}
    </code>
  );
}

// Fenced code block ( ``` … ``` ) — used by react-markdown's `pre > code`.
export function CodeFence({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const raw = useMemo(() => childrenToString(children).replace(/\n$/, ""), [children]);
  const lang = detectLangFromClassName(className);
  const html = useMemo(() => highlight(raw, lang), [raw, lang]);

  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border border-chrome-border bg-bg-soft">
      <div className="flex items-center justify-between border-b border-chrome-border/70 bg-chrome/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-mk-comment">
        <span className="flex items-center gap-2">
          <span className="text-mk-pink">▸</span>
          <span className="text-ink-dim">{lang || "text"}</span>
        </span>
        <button
          onClick={copy}
          className={cn(
            "inline-flex items-center gap-1 rounded border border-chrome-border/60 bg-bg-raised/60 px-1.5 py-[1px] text-[9.5px] tracking-[0.14em] transition-colors",
            copied
              ? "border-mk-green/60 text-mk-green"
              : "text-ink-faint opacity-0 group-hover:opacity-100 hover:border-mk-green/40 hover:text-mk-green"
          )}
        >
          {copied ? (
            <>
              <Check className="h-2.5 w-2.5" /> copied
            </>
          ) : (
            <>
              <Copy className="h-2.5 w-2.5" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto p-3 text-[11.5px] leading-[1.55]">
        <code
          className={cn("font-mono", className)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}

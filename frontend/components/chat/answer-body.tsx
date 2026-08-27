"use client";

import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/cn";
import type { SourceChunk } from "@/lib/rag";
import { CitationChip } from "./citation";
import { CodeFence, InlineCode } from "./code-block";

const CITE_RE = /\[#(\d{1,3})\]/g;

// react-markdown renders text as string children of block-level components.
// We wrap that renderer so citation markers become <CitationChip/>. Called
// from a `text` renderer OR post-processed against paragraphs — here we do
// it at the paragraph/list-item level by walking children.
function withCitations(node: ReactNode, sources: SourceChunk[] | undefined): ReactNode {
  if (typeof node === "string") {
    const parts: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    CITE_RE.lastIndex = 0;
    while ((m = CITE_RE.exec(node)) !== null) {
      const n = Number(m[1]);
      if (m.index > last) parts.push(node.slice(last, m.index));
      const source = sources && sources[n - 1] ? sources[n - 1] : null;
      parts.push(<CitationChip key={`c-${m.index}-${n}`} n={n} source={source} />);
      last = m.index + m[0].length;
    }
    if (last < node.length) parts.push(node.slice(last));
    return parts.length ? <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</> : node;
  }
  if (Array.isArray(node)) {
    return node.map((n, i) => <Fragment key={i}>{withCitations(n, sources)}</Fragment>);
  }
  return node;
}

function buildComponents(sources: SourceChunk[] | undefined): Components {
  const wrap = (children: ReactNode) => withCitations(children, sources);
  return {
    table: ({ children, ...props }) => (
      <div className="my-2 overflow-x-auto rounded border border-chrome-border/60">
        <table className="w-full border-collapse font-mono text-[11.5px]" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }) => (
      <th className="border-b border-chrome-border/60 bg-bg-raised/60 px-2 py-1 text-left text-ink" {...props}>
        {wrap(children)}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td className="border-b border-chrome-border/40 px-2 py-1 align-top text-ink-dim" {...props}>
        {wrap(children)}
      </td>
    ),
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children, ...rest }: {
      className?: string;
      children?: ReactNode;
    } & Record<string, unknown>) => {
      // react-markdown v9 no longer passes `inline`; use language-* className
      // + string children as the fence signal instead.
      const inline =
        typeof (rest as { inline?: boolean }).inline === "boolean"
          ? (rest as { inline?: boolean }).inline
          : !className || (typeof children === "string" && !children.includes("\n"));
      if (inline) return <InlineCode>{children}</InlineCode>;
      return <CodeFence className={className}>{children}</CodeFence>;
    },
    hr: () => <hr className="my-3 border-0 border-t border-chrome-border/40" />,
    p: ({ children }) => <p className="my-1.5 leading-relaxed">{wrap(children)}</p>,
    li: ({ children }) => <li>{wrap(children)}</li>,
    ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>,
    h1: ({ children }) => <h3 className="mt-3 mb-1 text-[15px] font-semibold text-ink">{wrap(children)}</h3>,
    h2: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold text-ink">{wrap(children)}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] font-semibold text-ink">{wrap(children)}</h4>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-mk-green pl-3 text-ink-dim">
        {wrap(children)}
      </blockquote>
    ),
  };
}

export function AnswerBody({
  content,
  sources,
  streaming,
  className,
}: {
  content: string;
  sources?: SourceChunk[];
  streaming?: boolean;
  className?: string;
}) {
  const components = buildComponents(sources);
  return (
    <div className={cn("prose-warp min-w-0 max-w-full text-[13.5px] leading-relaxed text-ink", className)}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
      {streaming && <span className="caret text-prompt align-baseline" />}
    </div>
  );
}

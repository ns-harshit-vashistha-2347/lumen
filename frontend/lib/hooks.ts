"use client";

// SWR-based data hooks. Purpose:
//   - dedupe repeated fetches across components on the same page
//     (chat sidebar + main pane both want the session list)
//   - revalidate on focus so a document that finished ingesting in another
//     tab shows up without a manual refresh
//   - single source of truth for cache keys so mutations can target them
//
// Install: `npm install swr` (already added to package.json). Nothing here
// crashes if swr isn't installed until the hook is actually rendered.

import useSWR, { mutate, type SWRConfiguration } from "swr";

import { chatSessionsApi, type ChatSession } from "./chat-history";
import { docsApi, type Document } from "./rag";

export const docsListKey = ["docs", "list"] as const;

export function useDocuments(opts?: SWRConfiguration<Document[]>) {
  return useSWR<Document[]>(
    docsListKey,
    () => docsApi.list(),
    {
      revalidateOnFocus: true,
      // Documents can move through parsing→embedding→completed in the
      // background; a light poll keeps status badges honest without
      // pounding the API.
      refreshInterval: (data) =>
        (data || []).some((d) => d.status !== "completed" && d.status !== "failed")
          ? 3000
          : 0,
      ...opts,
    }
  );
}

export function invalidateDocuments() {
  return mutate(docsListKey);
}

export function sessionsListKey(kind?: "doc" | "code", repoId?: string) {
  return ["chat", "sessions", kind || "all", repoId || ""] as const;
}

export function useChatSessions(
  params?: { kind?: "doc" | "code"; repoId?: string },
  opts?: SWRConfiguration<ChatSession[]>
) {
  const key = sessionsListKey(params?.kind, params?.repoId);
  return useSWR<ChatSession[]>(
    key,
    () => chatSessionsApi.list({ kind: params?.kind, repo_id: params?.repoId }),
    { revalidateOnFocus: true, ...opts }
  );
}

export function invalidateChatSessions(params?: { kind?: "doc" | "code"; repoId?: string }) {
  return mutate(sessionsListKey(params?.kind, params?.repoId));
}

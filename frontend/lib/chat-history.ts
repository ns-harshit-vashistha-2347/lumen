import { api } from "./api";

export type ChatKind = "doc" | "code";
export type ChatRole = "user" | "assistant";

export interface ChatSession {
  id: string;
  kind: ChatKind;
  repo_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  payload: Record<string, unknown> | null;
  trace_id: string | null;
  created_at: string;
}

export interface GraphStructure {
  name: string;
  nodes: { id: string }[];
  edges: { source: string; target: string; conditional?: boolean }[];
}

export interface GraphTraceEvent {
  type: "start" | "node" | "end";
  step?: number;
  node?: string;
  ts?: number;
  input_snapshot_keys?: string[];
  input_keys?: string[];
  output_keys?: string[];
  output_preview?: Record<string, string>;
}

export interface GraphTrace {
  trace_id: string;
  events: GraphTraceEvent[];
}

export const chatSessionsApi = {
  list: (opts: { kind?: ChatKind; repo_id?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.kind) q.set("kind", opts.kind);
    if (opts.repo_id) q.set("repo_id", opts.repo_id);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return api.get<ChatSession[]>(`/chat/sessions${suffix}`);
  },
  create: (kind: ChatKind, opts: { title?: string; repo_id?: string } = {}) =>
    api.post<ChatSession>("/chat/sessions", { kind, ...opts }),
  rename: (id: string, title: string) =>
    api.patch<ChatSession>(`/chat/sessions/${id}`, { title }),
  del: (id: string) => api.del<void>(`/chat/sessions/${id}`),
  messages: (id: string) =>
    api.get<StoredChatMessage[]>(`/chat/sessions/${id}/messages`),
};

export const graphApi = {
  structure: (name: "query" | "code_query" | "code_ingestion") =>
    api.get<GraphStructure>(`/chat/graphs/${name}`),
  trace: (traceId: string) => api.get<GraphTrace>(`/chat/traces/${traceId}`),
};

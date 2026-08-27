import { api } from "./api";

export type DocumentStatus =
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "storing"
  | "completed"
  | "failed";

export interface Document {
  id: string;
  filename: string;
  status: DocumentStatus;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceChunk {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface QueryResponse {
  answer: string;
  sources: SourceChunk[];
  session_id?: string | null;
  trace_id?: string | null;
}

export const docsApi = {
  list: () => api.get<Document[]>("/documents"),
  upload: (file: File) =>
    api.upload<{ document_id: string; filename: string; status: DocumentStatus; task_id: string }>(
      "/documents/upload",
      file
    ),
  status: (id: string) => api.get<Document>(`/documents/${id}`),
  delete: (id: string) => api.del<void>(`/documents/${id}`),
};

export const queryApi = {
  ask: (
    query: string,
    opts: {
      top_k?: number;
      document_ids?: string[];
      session_id?: string;
      persist?: boolean;
    } = {}
  ) => {
    const { top_k = 5, document_ids, session_id, persist } = opts;
    const body: Record<string, unknown> = { query, top_k };
    if (document_ids && document_ids.length > 0) body.document_ids = document_ids;
    if (session_id) body.session_id = session_id;
    if (persist) body.persist = true;
    return api.post<QueryResponse>("/query", body);
  },
};

// -------------------- v2.0 code playground -----------------------------------

export type RepoStatus =
  | "pending"
  | "cloning"
  | "parsing"
  | "embedding"
  | "storing"
  | "graph_building"
  | "completed"
  | "failed";

export interface Repo {
  id: string;
  owner: string;
  name: string;
  provider: string;
  default_branch: string;
  is_private: boolean;
  status: RepoStatus;
  error_message: string | null;
  total_files: number;
  indexed_files: number;
  total_chunks: number;
  size_bytes: number;
  last_indexed_sha: string | null;
  collection_name: string;
  created_at: string;
  updated_at: string;
}

export interface RepoPreview {
  owner: string;
  name: string;
  estimated_files: number;
  estimated_size_mb: number;
  would_reject: boolean;
  reject_reason: string | null;
}

export interface RepoProgress {
  status: RepoStatus;
  percent: number;
  total_files: number;
  indexed_files: number;
  total_chunks: number;
  error_message: string | null;
}

export interface GraphHit {
  kind: string; // "symbol" | "caller" | "callee"
  path: string;
  symbol?: string | null;
  symbol_kind?: string | null;
  start_line?: number | null;
  end_line?: number | null;
}

export interface CodeSourceChunk {
  path: string;
  symbol_name?: string | null;
  symbol_kind?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  content: string;
  score: number;
}

export interface CodeQueryResponse {
  answer: string;
  intent: string;
  graph_hits: GraphHit[];
  sources: CodeSourceChunk[];
  session_id?: string | null;
  trace_id?: string | null;
}

export const reposApi = {
  list: () => api.get<Repo[]>("/repos"),
  get: (id: string) => api.get<Repo>(`/repos/${id}`),
  preview: (url: string, token?: string) =>
    api.post<RepoPreview>("/repos/preview", { url, token: token || undefined }),
  connect: (url: string, token?: string, default_branch?: string) =>
    api.post<Repo>("/repos", {
      url,
      token: token || undefined,
      default_branch: default_branch || undefined,
    }),
  refresh: (id: string) => api.post<Repo>(`/repos/${id}/refresh`),
  progress: (id: string) => api.get<RepoProgress>(`/repos/${id}/progress`),
  del: (id: string) => api.del<void>(`/repos/${id}`),
};

export const codeQueryApi = {
  ask: (
    repo_id: string,
    query: string,
    opts: { top_k?: number; session_id?: string; persist?: boolean } = {}
  ) => {
    const body: Record<string, unknown> = { repo_id, query };
    if (opts.top_k) body.top_k = opts.top_k;
    if (opts.session_id) body.session_id = opts.session_id;
    if (opts.persist) body.persist = true;
    return api.post<CodeQueryResponse>("/code-query", body);
  },
  symbols: (repo_id: string, name: string) =>
    api.get<Array<Record<string, unknown>>>(
      `/code-query/${repo_id}/symbols?name=${encodeURIComponent(name)}`
    ),
  callers: (repo_id: string, name: string) =>
    api.get<Array<Record<string, unknown>>>(
      `/code-query/${repo_id}/callers?name=${encodeURIComponent(name)}`
    ),
  callees: (repo_id: string, name: string) =>
    api.get<Array<Record<string, unknown>>>(
      `/code-query/${repo_id}/callees?name=${encodeURIComponent(name)}`
    ),
};

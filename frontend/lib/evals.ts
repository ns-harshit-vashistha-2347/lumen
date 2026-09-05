import { api } from "./api";

export type EvalVerdict = "pass" | "partial" | "fail" | "error";
export type EvalRunStatus = "queued" | "running" | "completed" | "failed";

export interface EvalSuite {
  id: string;
  name: string;
  description: string | null;
  document_ids: string[] | null;
  created_at: string;
  updated_at: string;
  case_count: number;
}

export interface EvalCase {
  id: string;
  question: string;
  expected: string;
  created_at: string;
}

export interface EvalRun {
  id: string;
  suite_id: string;
  status: EvalRunStatus;
  total_cases: number;
  pass_count: number;
  partial_count: number;
  fail_count: number;
  error_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface EvalResult {
  id: string;
  case_id: string;
  verdict: EvalVerdict;
  actual_answer: string | null;
  judge_reason: string | null;
  latency_ms: number | null;
  score: number | null;
  sources: unknown[] | null;
  created_at: string;
}

export interface EvalRunDetail extends EvalRun {
  cases: EvalCase[];
  results: EvalResult[];
}

export const evalsApi = {
  listSuites: () => api.get<EvalSuite[]>("/evals/suites"),
  getSuite: (id: string) => api.get<EvalSuite>(`/evals/suites/${id}`),
  createSuite: (payload: {
    name: string;
    description?: string;
    document_ids?: string[];
  }) => api.post<EvalSuite>("/evals/suites", payload),
  deleteSuite: (id: string) => api.del<void>(`/evals/suites/${id}`),

  listCases: (suiteId: string) => api.get<EvalCase[]>(`/evals/suites/${suiteId}/cases`),
  addCase: (suiteId: string, payload: { question: string; expected: string }) =>
    api.post<EvalCase>(`/evals/suites/${suiteId}/cases`, payload),
  deleteCase: (caseId: string) => api.del<void>(`/evals/cases/${caseId}`),

  startRun: (suiteId: string) => api.post<EvalRun>(`/evals/suites/${suiteId}/run`),
  listRuns: (suiteId: string) => api.get<EvalRun[]>(`/evals/suites/${suiteId}/runs`),
  getRun: (runId: string) => api.get<EvalRunDetail>(`/evals/runs/${runId}`),
  latest: () =>
    api.get<{
      run: null | {
        id: string;
        suite_id: string;
        suite_name: string;
        pass_rate: number;
        pass_count: number;
        partial_count: number;
        fail_count: number;
        error_count: number;
        total_cases: number;
        finished_at: string | null;
      };
    }>("/evals/latest"),
};

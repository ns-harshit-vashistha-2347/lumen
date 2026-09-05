import { API_URL } from "./env";
import { tokenStore } from "./token-store";

export class ApiError extends Error {
  status: number;
  detail: string;
  // Machine-readable error code from the API envelope
  //   { error: { code, message, details } }
  // Optional so pre-envelope callers keep working.
  code?: string;
  details?: unknown;
  constructor(status: number, detail: string, code?: string, details?: unknown) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.details = details;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = tokenStore.getRefresh();
    if (!refresh) return null;

    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return null;
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
      };
      tokenStore.set(data.access_token, data.refresh_token);
      return data.access_token;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
  auth?: boolean; // default true
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, formData, auth = true } = opts;

  const doFetch = async (accessToken: string | null): Promise<Response> => {
    const finalHeaders: Record<string, string> = { ...headers };
    if (accessToken) finalHeaders["Authorization"] = `Bearer ${accessToken}`;

    let payload: BodyInit | undefined;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      finalHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    return fetch(`${API_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: payload,
    });
  };

  let access = auth ? tokenStore.getAccess() : null;
  let res = await doFetch(access);

  if (res.status === 401 && auth) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      res = await doFetch(newAccess);
    }
  }

  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    let details: unknown;
    try {
      const err = await res.json();
      // Preferred: new envelope { error: { code, message, details } }
      if (err && typeof err === "object" && err.error && typeof err.error === "object") {
        code = err.error.code;
        details = err.error.details;
        if (typeof err.error.message === "string") detail = err.error.message;
        // Validation issues live under details.issues — flatten to a
        // human-readable string for anywhere still consuming `.detail`.
        const issues =
          details && typeof details === "object" && Array.isArray((details as { issues?: unknown }).issues)
            ? ((details as { issues: { msg?: string; loc?: (string | number)[] }[] }).issues)
            : null;
        if (issues) {
          detail = issues
            .map((e) => {
              const loc = Array.isArray(e.loc) ? e.loc.slice(1).join(".") : "";
              return loc ? `${loc}: ${e.msg ?? ""}` : String(e.msg ?? "");
            })
            .join("; ");
        }
      } else {
        // Legacy FastAPI shape: { detail: "..." } or { detail: [{msg,loc}, ...] }
        const raw = err?.detail ?? err?.message ?? detail;
        if (Array.isArray(raw)) {
          detail = raw
            .map((e: { msg?: string; loc?: (string | number)[] }) => {
              if (e && typeof e === "object" && "msg" in e) {
                const loc = Array.isArray(e.loc) ? e.loc.slice(1).join(".") : "";
                return loc ? `${loc}: ${e.msg}` : String(e.msg);
              }
              return typeof e === "string" ? e : JSON.stringify(e);
            })
            .join("; ");
        } else if (typeof raw === "string") {
          detail = raw;
        } else if (raw != null) {
          detail = JSON.stringify(raw);
        }
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail, code, details);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: "POST", body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: "PATCH", body, auth }),
  put: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: "PUT", body, auth }),
  del: <T>(path: string, auth = true) =>
    request<T>(path, { method: "DELETE", auth }),
  upload: <T>(path: string, file: File, auth = true) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>(path, { method: "POST", formData: fd, auth });
  },
  // Fetch a raw file as a Blob URL with the Bearer token attached. Iframes
  // can't carry Authorization headers, so callers must use this to get a
  // blob: URL suitable as an <iframe src>. Remember to URL.revokeObjectURL
  // the returned string when done.
  blobUrl: async (path: string): Promise<string> => {
    const doFetch = async (accessToken: string | null) => {
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return fetch(`${API_URL}${path}`, { headers });
    };
    let res = await doFetch(tokenStore.getAccess());
    if (res.status === 401) {
      const t = await refreshAccessToken();
      if (t) res = await doFetch(t);
    }
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};

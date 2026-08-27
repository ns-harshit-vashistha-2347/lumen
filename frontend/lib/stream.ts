import { API_URL } from "./env";
import { ApiError } from "./api";
import { tokenStore } from "./token-store";

export interface StreamCallbacks {
  onMeta?: (meta: Record<string, unknown>) => void;
  onToken?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * POST to a text-streaming endpoint. The first line is expected to be a JSON
 * "meta" header; everything after that is treated as a raw text token stream.
 */
export async function postStream(
  path: string,
  body: unknown,
  cb: StreamCallbacks,
): Promise<void> {
  const doRequest = async (accessToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: cb.signal,
    });
  };

  try {
    let res = await doRequest(tokenStore.getAccess());

    // Try refresh once on 401
    if (res.status === 401) {
      const refresh = tokenStore.getRefresh();
      if (refresh) {
        try {
          const refr = await fetch(`${API_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refresh }),
            signal: cb.signal,
          });
          if (refr.ok) {
            const data = (await refr.json()) as {
              access_token: string;
              refresh_token: string;
            };
            tokenStore.set(data.access_token, data.refresh_token);
            res = await doRequest(data.access_token);
          } else {
            tokenStore.clear();
          }
        } catch {
          tokenStore.clear();
        }
      }
    }

    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const d = await res.json();
        if (d?.detail) detail = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
      } catch {
        /* noop */
      }
      throw new ApiError(res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffered = "";
    let sawMeta = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      if (!sawMeta) {
        const nl = buffered.indexOf("\n");
        if (nl >= 0) {
          const headerLine = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          sawMeta = true;
          try {
            const meta = JSON.parse(headerLine);
            cb.onMeta?.(meta);
          } catch {
            // If the first line isn't JSON, fold it into the token stream.
            cb.onToken?.(headerLine);
          }
        } else {
          // still waiting for the newline that terminates the meta line.
          continue;
        }
      }

      if (buffered.length > 0) {
        cb.onToken?.(buffered);
        buffered = "";
      }
    }

    cb.onDone?.();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    cb.onError?.(err as Error);
  }
}

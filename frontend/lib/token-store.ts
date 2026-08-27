const ACCESS_KEY = "rag_access_token";
const REFRESH_KEY = "rag_refresh_token";

// localStorage access can throw in private browsing modes or when the browser
// has blocked site data — swallow those so the app degrades to unauthenticated
// instead of white-screening.
export const tokenStore = {
  getAccess(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  getRefresh(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(access: string, refresh: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACCESS_KEY, access);
      window.localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* storage unavailable — user will just have to log in again */
    }
  },
  clear() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(ACCESS_KEY);
      window.localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* noop */
    }
  },
};

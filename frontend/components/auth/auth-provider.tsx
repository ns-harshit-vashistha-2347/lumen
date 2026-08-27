"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authApi, type User } from "@/lib/auth";
import { tokenStore } from "@/lib/token-store";
import { ApiError } from "@/lib/api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const preview =
      typeof window !== "undefined" &&
      window.location.search.includes("preview=1");
    if (preview) {
      setUser({ id: "preview", email: "you@lumen.dev", full_name: "Preview User" } as User);
      setLoading(false);
      return;
    }
    if (!tokenStore.getAccess()) {
      setUser(null);
      setLoading(false);
      router.replace("/login");
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
    } catch (err) {
      // Only wipe the token and redirect for a real auth failure (401/403).
      // For transient errors (5xx, network, CORS) keep the token so a retry
      // works, but still show the login page so the user isn't stuck on the
      // boot splash forever.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        tokenStore.clear();
        setUser(null);
        router.replace("/login");
      } else {
        setUser(null);
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await authApi.logout();
    setUser(null);
    router.replace("/login");
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, refetch: load }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

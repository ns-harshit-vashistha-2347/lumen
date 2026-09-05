"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { tokenStore } from "@/lib/token-store";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const claim = search.get("claim");
    // Wipe the URL first so the claim id doesn't linger in history or
    // get sent as a Referer on any subsequent nav from this page.
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* noop */
    }
    if (!claim) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    (async () => {
      try {
        const pair = await api.post<{ access_token: string; refresh_token: string }>(
          "/auth/oauth/exchange",
          { claim },
          /* auth */ false
        );
        tokenStore.set(pair.access_token, pair.refresh_token);
        router.replace("/chat");
      } catch {
        router.replace("/login?error=oauth_failed");
      }
    })();
  }, [router, search]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-prompt border-t-transparent" />
        <p className="text-sm text-ink-dim">Signing you in…</p>
      </div>
    </div>
  );
}

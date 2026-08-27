"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/token-store";

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // fragment (#...) is client-only; parse tokens the backend appended
    const fragment = window.location.hash.slice(1);
    const params = new URLSearchParams(fragment);
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");

    if (access && refresh) {
      tokenStore.set(access, refresh);
      router.replace("/chat");
    } else {
      router.replace("/login?error=oauth_failed");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-prompt border-t-transparent" />
        <p className="text-sm text-ink-dim">Signing you in…</p>
      </div>
    </div>
  );
}

"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { AppChrome } from "@/components/app-chrome";
import { CommandPalette } from "@/components/command-palette";
import { BootSplash } from "@/components/boot-splash";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const preview =
    typeof window !== "undefined" &&
    window.location.search.includes("preview=1");

  if (!preview && (loading || !user)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-xs tracking-[0.2em] text-ink-dim">
          BOOT<span className="caret" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <BootSplash />
      <AppChrome />
      <main className="flex-1 overflow-hidden">{children}</main>
      <CommandPalette />
    </div>
  );
}

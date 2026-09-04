"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/token-store";
import { MatrixRain } from "@/components/matrix-rain";

const BOOT_LINES = [
  "BIOS v0.2.7 — lumen platform  © anthropos labs",
  "cpu.......... 8 x wasm-turbo @ 3.6ghz [ ok ]",
  "mem.......... 16384 MiB ecc ................ [ ok ]",
  "net.......... link up · mtu 1500 · tls 1.3 . [ ok ]",
  "vector db.... pinecone shard 04 · warm ..... [ ok ]",
  "retriever.... hybrid bm25 + dense ........... [ ok ]",
  "llm pool..... openai · anthropic · groq ..... [ ok ]",
  "auth bridge.. jwt · rs256 · rotating ........ [ ok ]",
  "session bus.. sse · reconnect=exponential .. [ ok ]",
  "mounting /workspace .......................... [ ok ]",
  "handshake.... x25519 kx complete ............ [ ok ]",
];

export default function RootPage() {
  const router = useRouter();
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i >= BOOT_LINES.length) {
        clearInterval(id);
        setDone(true);
        return;
      }
      const next = BOOT_LINES[i];
      i++;
      setLines((prev) => (prev.length >= BOOT_LINES.length ? prev : [...prev, next]));
    }, 90);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      if (tokenStore.getAccess()) router.replace("/chat");
      else router.replace("/login");
    }, 380);
    return () => clearTimeout(t);
  }, [done, router]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <MatrixRain opacity={0.45} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 hacker-grid opacity-50" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-scanline opacity-50 mix-blend-overlay" />
      <div aria-hidden className="pointer-events-none absolute inset-0 crt-vignette" />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="scan-line" />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6">
        <div className="mb-6 text-center">
          <pre className="mx-auto inline-block font-mono text-[10px] leading-[1.1] text-prompt drop-shadow-[0_0_18px_rgba(249,38,114,0.75)] sm:text-[12px]">
{String.raw`  _     _   _ __  __ _____ _  _
 | |   | | | |  \/  | ____| \| |
 | |   | | | | |\/| |  _| | .  |
 | |___| |_| | |  | | |___| |\  |
 |_____|\___/|_|  |_|_____|_| \_|`}
          </pre>
          <div className="mt-2 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.32em] text-mk-green">
            <span className="hud-chip"><span className="k">node</span><span className="v">lumen-a04c</span></span>
            <span className="glitch neon-text-green" data-text="initializing">initializing</span>
            <span className="caret text-mk-green" />
          </div>
        </div>

        <div className="terminal-frame overflow-hidden rounded-md">
          <div className="flex h-8 items-center gap-2 border-b border-chrome-border bg-chrome px-3 font-mono text-[10.5px] tracking-[0.22em] text-ink-faint">
            <span className="h-2.5 w-2.5 rounded-full bg-mk-pink/90 shadow-[0_0_6px_currentColor]" />
            <span className="h-2.5 w-2.5 rounded-full bg-mk-yellow/90 shadow-[0_0_6px_currentColor]" />
            <span className="h-2.5 w-2.5 rounded-full bg-mk-green/90 shadow-[0_0_6px_currentColor]" />
            <span className="ml-2">/dev/lumen/boot.sh</span>
          </div>
          <div className="p-4 font-mono text-[12px] leading-[1.55] text-ink-dim">
            <div className="text-mk-green">$ ./boot --profile=prod --verbose</div>
            {lines.map((l, i) => {
              if (typeof l !== "string") return null;
              const okIdx = l.lastIndexOf("[ ok ]");
              if (okIdx < 0) {
                return (
                  <div key={i} className="text-ink-muted">
                    {l}
                  </div>
                );
              }
              return (
                <div key={i}>
                  <span className="text-ink-muted">{l.slice(0, okIdx)}</span>
                  <span className="text-mk-green">{l.slice(okIdx)}</span>
                </div>
              );
            })}
            {done ? (
              <div className="mt-1 text-prompt neon-text">
                ▸ redirect → {tokenStore.getAccess() ? "/chat" : "/login"}
                <span className="caret" />
              </div>
            ) : (
              <div className="mt-1 text-ink-faint">
                <span className="caret" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

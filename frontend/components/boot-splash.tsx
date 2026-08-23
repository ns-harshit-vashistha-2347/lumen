"use client";

import { useEffect, useRef, useState } from "react";

const CHARS = "01ABCDEF#$*+lumen▸◆";

export function BootSplash() {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"rain" | "fade" | "gone">("rain");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("lumen.boot") === "1") return;
    sessionStorage.setItem("lumen.boot", "1");
    setVisible(true);
    const t1 = setTimeout(() => setPhase("fade"), 900);
    const t2 = setTimeout(() => setPhase("gone"), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const cols = Math.floor(window.innerWidth / 14);
    const drops = Array.from({ length: cols }, () => Math.random() * -30);
    let raf = 0;

    const tick = () => {
      ctx.fillStyle = "rgba(39, 40, 34, 0.18)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = "14px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#a6e22e";
      drops.forEach((y, i) => {
        const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * 14;
        ctx.fillStyle = y > 0 && Math.random() > 0.985 ? "#f92672" : "#a6e22e";
        ctx.fillText(ch, x, y * 16);
        drops[i] = y * 16 > window.innerHeight && Math.random() > 0.95 ? -1 : y + 1;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible || phase === "gone") return null;

  return (
    <div
      className={
        "pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-bg transition-opacity duration-500 " +
        (phase === "fade" ? "opacity-0" : "opacity-100")
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="relative z-10 text-center">
        <pre className="font-mono text-[12px] leading-[1.1] text-prompt drop-shadow-[0_0_16px_rgba(249,38,114,0.7)]">
{String.raw` __   _   _  __  __ ___ _  _
| |  | | | ||  \/  | __| \| |
| |__| |_| || |\/| | _|| .  |
|____|\___/ |_|  |_|___|_|\_|`}
        </pre>
        <div className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.3em] text-mk-green">
          initializing<span className="caret text-mk-green" />
        </div>
      </div>
    </div>
  );
}

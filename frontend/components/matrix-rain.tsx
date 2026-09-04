"use client";

import { useEffect, useRef } from "react";

const CHARS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノ01ABCDEF#$*+lumen▸◆░▒▓█";

export function MatrixRain({
  opacity = 0.35,
  speed = 1,
  colorVar = "--c-prompt",
  headVar = "--c-prompt-glow",
  className = "",
}: {
  opacity?: number;
  speed?: number;
  colorVar?: string;
  headVar?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let cols = 0;
    let drops: number[] = [];
    const fontSize = 14;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      cols = Math.floor(width / fontSize);
      drops = Array.from({ length: cols }, () => Math.random() * -60);
    };
    resize();
    window.addEventListener("resize", resize);

    const readVar = (v: string) => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(v)
        .trim();
      return raw || "0 255 102";
    };

    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      const dt = t - last;
      if (dt < 40 / speed) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = t;

      const bg = readVar("--c-bg");
      ctx.fillStyle = `rgba(${bg}, 0.11)`;
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
      const body = readVar(colorVar);
      const head = readVar(headVar);

      for (let i = 0; i < cols; i++) {
        const y = drops[i];
        const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * fontSize;
        const py = y * fontSize;

        ctx.fillStyle = `rgba(${body}, 0.85)`;
        ctx.fillText(ch, x, py);

        if (Math.random() > 0.975) {
          ctx.fillStyle = `rgba(${head}, 1)`;
          ctx.fillText(ch, x, py);
        }

        if (py > height && Math.random() > 0.965) drops[i] = -2;
        else drops[i] = y + 1;
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [colorVar, headVar, speed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ opacity }}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}

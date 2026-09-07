"use client";

import { useEffect, useState } from "react";
import { Palette, Sun } from "lucide-react";

export type ThemeName = "monokai" | "light";

const ORDER: ThemeName[] = ["monokai", "light"];

function applyTheme(t: ThemeName) {
  const html = document.documentElement;
  if (t === "monokai") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", t);
  try {
    localStorage.setItem("lumen.theme", t);
  } catch {
    /* noop */
  }
}

function readStored(): ThemeName {
  if (typeof window === "undefined") return "monokai";
  try {
    const v = localStorage.getItem("lumen.theme") as ThemeName | null;
    if (v === "light" || v === "monokai") return v;
    // Any stored value from the retired themes (matrix / nova) falls
    // back to monokai instead of leaving the app in an unknown state.
  } catch {
    /* noop */
  }
  return "monokai";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>("monokai");

  useEffect(() => {
    const stored = readStored();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function cycle() {
    const idx = ORDER.indexOf(theme);
    const next = ORDER[(idx + 1) % ORDER.length];
    setTheme(next);
    applyTheme(next);
  }

  const meta =
    theme === "light"
      ? { icon: <Sun className="h-3 w-3 text-mk-yellow" />, label: "light" }
      : { icon: <Palette className="h-3 w-3 text-mk-pink" />, label: "monokai" };

  return (
    <button
      onClick={cycle}
      title={`theme: ${meta.label} — click to cycle`}
      className="hidden items-center gap-1.5 rounded-md border border-chrome-border bg-chrome-hover/40 px-2 py-1 font-mono text-[10.5px] text-ink-dim hover:border-prompt/40 hover:text-ink md:inline-flex"
    >
      {meta.icon}
      <span>{meta.label}</span>
    </button>
  );
}

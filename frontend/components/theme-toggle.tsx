"use client";

import { useEffect, useState } from "react";
import { Terminal, Palette } from "lucide-react";

export type ThemeName = "monokai" | "matrix";

function applyTheme(t: ThemeName) {
  const html = document.documentElement;
  if (t === "monokai") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", t);
  try {
    localStorage.setItem("lumen.theme", t);
  } catch {}
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>("monokai");

  useEffect(() => {
    const stored =
      (typeof window !== "undefined" &&
        (localStorage.getItem("lumen.theme") as ThemeName | null)) ||
      "monokai";
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function toggle() {
    const next: ThemeName = theme === "monokai" ? "matrix" : "monokai";
    setTheme(next);
    applyTheme(next);
  }

  const isMatrix = theme === "matrix";
  return (
    <button
      onClick={toggle}
      title={isMatrix ? "switch to monokai" : "switch to matrix terminal"}
      className="hidden items-center gap-1.5 rounded-md border border-chrome-border bg-chrome-hover/40 px-2 py-1 font-mono text-[10.5px] text-ink-dim hover:border-prompt/40 hover:text-ink md:inline-flex"
    >
      {isMatrix ? (
        <>
          <Terminal className="h-3 w-3 text-mk-green" />
          <span>matrix</span>
        </>
      ) : (
        <>
          <Palette className="h-3 w-3 text-mk-pink" />
          <span>monokai</span>
        </>
      )}
    </button>
  );
}

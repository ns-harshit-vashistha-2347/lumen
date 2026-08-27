"use client";

import { useEffect, useState } from "react";

const KEY = "lumen:scope";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — scope becomes session-local */
  }
  window.dispatchEvent(new Event("lumen:scope-change"));
}

export const scopeStore = {
  get: () => read(),
  set: (ids: Iterable<string>) => write(new Set(ids)),
  toggle: (id: string) => {
    const s = read();
    if (s.has(id)) s.delete(id);
    else s.add(id);
    write(s);
  },
  add: (id: string) => {
    const s = read();
    s.add(id);
    write(s);
  },
  remove: (id: string) => {
    const s = read();
    s.delete(id);
    write(s);
  },
  clear: () => write(new Set()),
};

export function useScope(): [Set<string>, typeof scopeStore] {
  const [scope, setScope] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setScope(read());
    const onChange = () => setScope(read());
    window.addEventListener("lumen:scope-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("lumen:scope-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return [scope, scopeStore];
}

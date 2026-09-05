"use client";

// Lazy wrapper for the ~1000-line GraphVisualizer panel. The panel is only
// mounted after a user clicks the "graph" button, so there's no reason to
// ship its code in the initial page bundle. next/dynamic + ssr:false code-
// splits it into a separate chunk that's fetched on first open.
//
// GraphButton is small and needs to be interactive on first paint, so it
// stays a normal (statically-imported) re-export.

import dynamic from "next/dynamic";

export { GraphButton } from "./graph-visualizer";

export const GraphVisualizer = dynamic(
  () => import("./graph-visualizer").then((m) => m.GraphVisualizer),
  {
    ssr: false,
    loading: () => null,
  }
);

// Next.js / Turbopack / webpack asset-URL imports:
//   import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// The `?url` suffix returns the built asset's public URL as the default
// export. TS doesn't know about this loader, so shim it here.

declare module "*?url" {
  const url: string;
  export default url;
}

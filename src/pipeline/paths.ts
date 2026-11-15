/**
 * Small Windows path helpers.
 *
 * `node:path` is unavailable in the webview, and the pipeline runs there too,
 * so filesystem paths are handled here. Zip entry names are a different thing:
 * they always use forward slashes and are handled with plain string logic in
 * clean.ts.
 */

const SEPARATORS = /[\\/]/;

export function dirname(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut < 0) return "";
  const head = path.slice(0, cut);
  // Keep the root of "C:\file" as "C:\" rather than "C:".
  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head;
}

export function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut < 0 ? path : path.slice(cut + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

export function joinPath(...parts: string[]): string {
  const kept = parts.filter((part) => part !== "");
  if (kept.length === 0) return "";
  const separator = SEPARATORS.test(kept[0])
    ? kept[0].includes("\\")
      ? "\\"
      : "/"
    : "\\";
  return kept
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/u, "")
        : part.replace(/^[\\/]+|[\\/]+$/gu, ""),
    )
    .filter((part, index) => index === 0 || part !== "")
    .join(separator);
}

export function stripExtension(path: string): string {
  const extension = extname(path);
  return extension ? path.slice(0, -extension.length) : path;
}

export function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Compare folders the way Windows does: separators, casing, trailing slash. */
export function normalizedFolder(path: string): string {
  return path
    .replace(/[\\/]+$/u, "")
    .replace(/\\/gu, "/")
    .toLowerCase();
}

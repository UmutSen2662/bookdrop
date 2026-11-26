/**
 * Screenshot/demo mode. Enabled only by `bun run demo` (`BOOKDROP_DEMO=1`) in
 * development. The real config, database, and library are never opened; this
 * module loads a small in-memory set of public-domain books instead.
 */

import type { Config } from "@/pipeline/config";
import type { Book } from "@/pipeline/types";

const covers = new Map<number, string>();
const coverSizes = new Map<number, { width: number; height: number }>();
let active = false;

export function isDemoMode(): boolean {
  return active;
}

/** The bundled cover for a demo book, or null outside demo mode. */
export function demoCoverUrl(bookId: number): string | null {
  return covers.get(bookId) ?? null;
}

export function demoCoverSize(
  bookId: number,
): { width: number; height: number } | null {
  return coverSizes.get(bookId) ?? null;
}

export async function loadDemoLibrary(): Promise<{
  config: Config;
  books: Book[];
}> {
  // Loaded lazily so the demo data does not inflate the main bundle.
  const demo = await import("@/demo/books");
  for (const [id, url] of Object.entries(demo.DEMO_COVERS)) {
    covers.set(Number(id), url);
  }
  for (const [id, size] of Object.entries(demo.DEMO_COVER_SIZES)) {
    coverSizes.set(Number(id), size);
  }
  active = true;
  return { config: demo.DEMO_CONFIG, books: demo.DEMO_BOOKS };
}

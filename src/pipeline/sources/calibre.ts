/**
 * calibre's `fetch-ebook-metadata` with Google and Open Library pinned.
 *
 * The command returns one OPF already merged by calibre, so this stays a single
 * source: the app cannot attribute a field to Google or Open Library
 * separately. The id predates the registry and is stored in existing rows.
 */
import { fetchMetadata } from "@/pipeline/calibre";
import { parseOpf } from "@/pipeline/metadata";
import type { BookSource, SourceResult } from "@/pipeline/sources/types";

export const calibreSource: BookSource = {
  id: "google_openlibrary",
  kinds: ["metadata"],

  async lookup(query, context): Promise<SourceResult | null> {
    if (!context.install) return null;

    const fetched = await fetchMetadata(context.host, context.install, {
      isbn: query.isbn,
      title: query.title,
      authors: query.authors,
    });
    const xml = fetched.stdout.trim();
    if (!xml.startsWith("<?xml")) return null;
    try {
      const parsed = parseOpf(xml);
      if (!parsed.title && !parsed.authors) return null;
      return {
        metadata: parsed,
        match: { title: parsed.title, authors: parsed.authors },
      };
    } catch {
      // A partial OPF after a timeout is not worth failing the lookup for.
      return null;
    }
  },
};

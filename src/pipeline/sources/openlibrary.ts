/**
 * Open Library search: a cover by `cover_i`, plus title and authors as a third
 * opinion. No key, one JSON request.
 */
import { surnamesMatch, titlesMatch } from "../metadata";
import { joinPath } from "../paths";
import type { Metadata } from "../types";
import { parseJson } from "./json";
import type { BookSource, SourceResult } from "./types";

const HTTP_TIMEOUT = 15_000;

type OpenLibraryResponse = {
  docs?: Array<{
    title?: string;
    author_name?: string[];
    cover_i?: number;
  }>;
};

export const openLibrarySource: BookSource = {
  id: "open_library",
  kinds: ["metadata", "cover"],

  async lookup(query, context): Promise<SourceResult | null> {
    const url =
      "https://openlibrary.org/search.json?" +
      new URLSearchParams({
        title: query.title,
        author: query.authors,
        fields: "title,author_name,cover_i",
        limit: "5",
      }).toString();

    const destination = joinPath(context.workDir, "openlibrary.json");
    try {
      const response = await context.host.httpGet(
        url,
        destination,
        HTTP_TIMEOUT,
      );
      if (response.status !== 200) return null;
      const data = parseJson<OpenLibraryResponse>(
        await context.host.readFile(destination),
      );
      const match = data?.docs?.find(
        (doc) =>
          titlesMatch(query.title, doc.title ?? "") &&
          (doc.author_name ?? []).some((author) =>
            surnamesMatch(query.authors, author),
          ),
      );
      if (!match?.title) return null;

      const metadata: Partial<Metadata> = { title: match.title };
      const authors = (match.author_name ?? [])
        .map((author) => author.trim())
        .filter(Boolean)
        .join(" & ");
      if (authors) metadata.authors = authors;

      const coverUrl = match.cover_i
        ? `https://covers.openlibrary.org/b/id/${match.cover_i}` +
          "-L.jpg?default=false"
        : undefined;

      return {
        metadata,
        covers: coverUrl ? [{ source: "open_library", url: coverUrl }] : [],
      };
    } catch {
      // A timeout or a network error is not an ingest failure.
      return null;
    }
  },
};

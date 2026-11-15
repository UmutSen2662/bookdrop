/**
 * iTunes Search: the fastest cover source, and a second opinion on title and
 * author. No key, one JSON request.
 */
import { surnamesMatch, titlesMatch } from "../metadata";
import { joinPath } from "../paths";
import type { Metadata } from "../types";
import { parseJson } from "./json";
import type { BookSource, SourceResult } from "./types";

const HTTP_TIMEOUT = 15_000;

type ItunesResponse = {
  results?: Array<{
    trackName?: string;
    artistName?: string;
    artworkUrl100?: string;
  }>;
};

export const itunesSource: BookSource = {
  id: "itunes",
  kinds: ["metadata", "cover"],

  async lookup(query, context): Promise<SourceResult | null> {
    const url =
      "https://itunes.apple.com/search?" +
      new URLSearchParams({
        term: `${query.title} ${query.authors}`,
        entity: "ebook",
        limit: "5",
      }).toString();

    const destination = joinPath(context.workDir, "itunes.json");
    try {
      const response = await context.host.httpGet(
        url,
        destination,
        HTTP_TIMEOUT,
      );
      if (response.status !== 200) return null;
      const data = parseJson<ItunesResponse>(
        await context.host.readFile(destination),
      );
      const match = data?.results?.find(
        (result) =>
          titlesMatch(query.title, result.trackName ?? "") &&
          surnamesMatch(query.authors, result.artistName ?? ""),
      );
      if (!match?.trackName) return null;

      const metadata: Partial<Metadata> = { title: match.trackName };
      if (match.artistName) metadata.authors = match.artistName;

      return {
        metadata,
        covers: match.artworkUrl100
          ? [
              {
                source: "itunes",
                // The 100 px thumbnail is too small to test, and the 1000 px
                // artwork is the same image under the same path.
                url: match.artworkUrl100.replace(
                  /100x100bb\.jpg/iu,
                  "1000x1000bb.jpg",
                ),
              },
            ]
          : [],
      };
    } catch {
      // A timeout or a network error is not an ingest failure.
      return null;
    }
  },
};

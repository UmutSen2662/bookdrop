import { describe, expect, it } from "vitest";
import { BOOK_SOURCES, runSources, selectSources } from "@/pipeline/sources";
import { itunesSource } from "@/pipeline/sources/itunes";
import { openLibrarySource } from "@/pipeline/sources/openlibrary";
import type { BookSource, SourceQuery } from "@/pipeline/sources/types";
import { FakeHost, jsonResponse } from "@/pipeline/test-host";

const QUERY = { title: "She Drives Me Crazy", authors: "Kelly Quindlen" };

function runItunes(host: FakeHost, query: SourceQuery = QUERY) {
  return itunesSource.lookup(query, {
    host,
    install: null,
    workDir: "/work/itunes",
  });
}

function runOpenLibrary(host: FakeHost, query: SourceQuery = QUERY) {
  return openLibrarySource.lookup(query, {
    host,
    install: null,
    workDir: "/work/open_library",
  });
}

describe("itunesSource", () => {
  it("keeps only a matching result and upgrades the artwork URL", async () => {
    const host = new FakeHost(() =>
      jsonResponse({
        results: [
          { trackName: "Some Other Book", artistName: "Someone" },
          {
            trackName: "She Drives Me Crazy",
            artistName: "Kelly Quindlen",
            artworkUrl100: "https://is1.example/100x100bb.jpg",
          },
        ],
      }),
    );

    const result = await runItunes(host);

    expect(result?.metadata).toEqual({
      title: "She Drives Me Crazy",
      authors: "Kelly Quindlen",
    });
    expect(result?.covers).toEqual([
      { source: "itunes", url: "https://is1.example/1000x1000bb.jpg" },
    ]);
  });

  it("matches a subtitle and a trailing parenthetical", async () => {
    const host = new FakeHost(() =>
      jsonResponse({
        results: [
          {
            trackName: "She Drives Me Crazy (A Novel)",
            artistName: "Kelly Quindlen",
            artworkUrl100: "https://is1.example/100x100bb.jpg",
          },
        ],
      }),
    );

    const result = await runItunes(host, {
      title: "She Drives Me Crazy: A Novel",
      authors: "Kelly Quindlen",
    });
    expect(result?.metadata?.title).toBe("She Drives Me Crazy (A Novel)");
  });

  it("treats a failed request as no result", async () => {
    const host = new FakeHost(() => ({
      status: 500,
      contentType: "text/html",
    }));

    expect(await runItunes(host)).toBeNull();
  });

  it("treats malformed JSON as no result", async () => {
    const host = new FakeHost(() => ({
      status: 200,
      contentType: "application/json",
      body: new TextEncoder().encode("{nope"),
    }));

    expect(await runItunes(host)).toBeNull();
  });
});

describe("openLibrarySource", () => {
  it("keeps a matching cover and offers its title and authors", async () => {
    const host = new FakeHost(() =>
      jsonResponse({
        docs: [
          { title: "Unrelated", author_name: ["Nobody"] },
          {
            title: "She Drives Me Crazy",
            author_name: ["Kelly Quindlen"],
            cover_i: 42,
          },
        ],
      }),
    );

    const result = await runOpenLibrary(host);

    expect(result?.metadata).toEqual({
      title: "She Drives Me Crazy",
      authors: "Kelly Quindlen",
    });
    expect(result?.covers).toEqual([
      {
        source: "open_library",
        url: "https://covers.openlibrary.org/b/id/42-L.jpg?default=false",
      },
    ]);
  });

  it("still returns metadata when the match has no cover", async () => {
    const host = new FakeHost(() =>
      jsonResponse({
        docs: [
          { title: "She Drives Me Crazy", author_name: ["Kelly Quindlen"] },
        ],
      }),
    );

    const result = await runOpenLibrary(host);

    expect(result?.metadata?.title).toBe("She Drives Me Crazy");
    expect(result?.covers).toEqual([]);
  });

  it("joins multiple authors with calibre's separator", async () => {
    const host = new FakeHost(() =>
      jsonResponse({
        docs: [
          {
            title: "She Drives Me Crazy",
            author_name: ["Kelly Quindlen", "Someone Else"],
            cover_i: 42,
          },
        ],
      }),
    );

    const result = await runOpenLibrary(host);
    expect(result?.metadata?.authors).toBe("Kelly Quindlen & Someone Else");
  });

  it("treats a failed request as no result", async () => {
    const host = new FakeHost(() => ({
      status: 503,
      contentType: "text/html",
    }));
    expect(await runOpenLibrary(host)).toBeNull();
  });
});

describe("BOOK_SOURCES", () => {
  it("has unique, path-safe ids", () => {
    const ids = BOOK_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // Ids become candidate values, work-directory names, and label keys.
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/u);
    }
  });
});

describe("selectSources", () => {
  it("excludes metadata-only sources when only covers are on", () => {
    const ids = selectSources({ metadata: false, covers: true }).map(
      (source) => source.id,
    );
    expect(ids).toEqual(["itunes", "open_library"]);
  });

  it("includes every source when both kinds are on", () => {
    expect(selectSources({ metadata: true, covers: true })).toEqual(
      BOOK_SOURCES,
    );
  });

  it("selects nothing when both are off", () => {
    expect(selectSources({ metadata: false, covers: false })).toEqual([]);
  });
});

describe("runSources", () => {
  it("runs sources concurrently and turns a failure into a note", async () => {
    const broken: BookSource = {
      id: "broken",
      kinds: ["metadata"],
      lookup: async () => {
        throw new Error("boom");
      },
    };
    const working: BookSource = {
      id: "itunes",
      kinds: ["metadata"],
      lookup: async () => ({ metadata: { title: "Found" } }),
    };
    const host = new FakeHost();

    const outcome = await runSources([broken, working], QUERY, {
      host,
      install: null,
      baseDir: "/work/lookup",
    });

    expect(outcome.notes).toEqual(["broken lookup failed: boom"]);
    expect(outcome.runs).toHaveLength(1);
    expect(outcome.runs[0].source.id).toBe("itunes");
    expect(outcome.runs[0].result.metadata?.title).toBe("Found");
    expect(host.dirs.has("/work/lookup/broken")).toBe(true);
    expect(host.dirs.has("/work/lookup/itunes")).toBe(true);
  });

  it("drops a source that returns null", async () => {
    const empty: BookSource = {
      id: "empty",
      kinds: ["metadata"],
      lookup: async () => null,
    };
    const outcome = await runSources([empty], QUERY, {
      host: new FakeHost(),
      install: null,
      baseDir: "/work/lookup",
    });
    expect(outcome.runs).toEqual([]);
    expect(outcome.notes).toEqual([]);
  });
});

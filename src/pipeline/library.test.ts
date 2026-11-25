import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "@/pipeline/config";
import { BookStore, type Sql } from "@/pipeline/db";
import type {
  FileStat,
  Host,
  HttpResult,
  ProcessResult,
} from "@/pipeline/host";
import {
  applyLibraryRenames,
  checkBookFile,
  editBook,
  ensureFullCover,
  planLibraryRenames,
  readCoverSize,
  reconcile,
  refreshBookMetadata,
  removeBook,
  startup,
} from "@/pipeline/library";
import { openTestSql } from "@/pipeline/test-sql";
import { emptyCandidates, type IngestOutcome } from "@/pipeline/types";

type FakeMetadata = {
  title: string;
  authors: string;
  uuid?: string;
  tags?: string;
  series?: string;
  seriesIndex?: string;
};

class FakeHost implements Host {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  hashes = new Map<string, string>();
  metadata = new Map<string, FakeMetadata>();
  /** What `fetch-ebook-metadata` returns, when a test wants a provider hit. */
  fetchResult: FakeMetadata | null = null;
  hashCalls = 0;
  writeFails = false;

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return bytes;
  }

  async writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async copyFile(from: string, to: string): Promise<void> {
    this.files.set(to, this.files.get(from) ?? new Uint8Array());
  }

  async renameFile(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) throw new Error(`ENOENT ${from}`);
    if (this.files.has(to) || this.dirs.has(to)) {
      throw new Error(`will not overwrite ${to}`);
    }
    this.files.delete(from);
    this.files.set(to, bytes);
    this.hashes.set(to, this.hashes.get(from) ?? `hash:${to}`);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureDir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async removeDir(path: string): Promise<void> {
    this.dirs.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key.startsWith(`${path}/`)) this.dirs.delete(key);
    }
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) names.add(rest);
    }
    return [...names];
  }

  async stat(path: string): Promise<FileStat | null> {
    const bytes = this.files.get(path);
    if (bytes) return { size: bytes.length, mtimeMs: 0, isDirectory: false };
    if (
      this.dirs.has(path) ||
      [...this.files.keys()].some((key) => key.startsWith(`${path}/`))
    ) {
      return { size: 0, mtimeMs: 0, isDirectory: true };
    }
    return null;
  }

  async hashFile(path: string): Promise<string> {
    this.hashCalls++;
    return this.hashes.get(path) ?? `hash:${path}`;
  }

  async runProcess(program: string, args: string[]): Promise<ProcessResult> {
    if (program.toLowerCase().includes("fetch-ebook-metadata")) {
      return {
        code: 0,
        stdout: this.fetchResult ? opf(this.fetchResult) : "",
        stderr: "",
        timedOut: false,
      };
    }
    if (!program.toLowerCase().includes("ebook-meta")) {
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }

    const opfIndex = args.indexOf("--to-opf");
    if (opfIndex >= 0) {
      const epub = args[0];
      const target = args[opfIndex + 1];
      const metadata = this.metadata.get(epub) ?? { title: "", authors: "" };
      this.files.set(target, new TextEncoder().encode(opf(metadata)));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }

    const coverIndex = args.indexOf("--get-cover");
    if (coverIndex >= 0) {
      this.files.set(args[coverIndex + 1], new Uint8Array([1, 2, 3]));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }

    if (this.writeFails) {
      return { code: 1, stdout: "", stderr: "boom", timedOut: false };
    }

    // writeMetadata: <epub> --title ... --authors ...
    const title = args[args.indexOf("--title") + 1] ?? "";
    const authors = args[args.indexOf("--authors") + 1] ?? "";
    if (title || authors) {
      this.metadata.set(args[0], { title, authors });
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  async httpGet(
    _url: string,
    _destination: string,
    _timeoutMs: number,
  ): Promise<HttpResult> {
    throw new Error("not used");
  }

  async makeThumbnail(source: string, destination: string): Promise<void> {
    this.files.set(destination, this.files.get(source) ?? new Uint8Array([9]));
  }

  async imageSize(): Promise<{ width: number; height: number } | null> {
    return { width: 1200, height: 1800 };
  }

  env(): string | undefined {
    return undefined;
  }
}

/** A 662×1000 JPEG header with enough padding to pass the cover validator. */
function jpeg(): Uint8Array {
  const header = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0xe8, 0x02, 0x96, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const output = new Uint8Array(9_000);
  output.set(header);
  return output;
}

function opf(metadata: FakeMetadata): string {
  const uuid = metadata.uuid
    ? `<dc:identifier opf:scheme="uuid" xmlns:opf="http://www.idpf.org/2007/opf">urn:uuid:${metadata.uuid}</dc:identifier>`
    : "";
  const tags = metadata.tags
    ? metadata.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => `<dc:subject>${tag}</dc:subject>`)
        .join("")
    : "";
  const series = metadata.series
    ? `<meta name="calibre:series" content="${metadata.series}"/>`
    : "";
  const seriesIndex = metadata.seriesIndex
    ? `<meta name="calibre:series_index" content="${metadata.seriesIndex}"/>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${metadata.title}</dc:title>
    <dc:creator opf:file-as="${metadata.authors.split(" ").reverse().join(", ")}">${metadata.authors}</dc:creator>
    ${uuid}
    ${tags}
    ${series}
    ${seriesIndex}
  </metadata>
</package>`;
}

function config(): Config {
  return {
    homeDir: "/home",
    libraryDir: "/library",
    archiveOriginals: false,
    originalsDir: "/originals",
    fetchMetadata: true,
    cleanConverted: true,
    fetchCovers: true,
    calibreDir: null,
    sortBy: "author",
    fileNameTemplate: "{author} - {title}",
  };
}

const install = { dir: "C:\\Calibre", version: "9.18.0" };

function outcome(overrides: Partial<IngestOutcome> = {}): IngestOutcome {
  return {
    sourcePath: "/drop/book.epub",
    sha256: "a".repeat(64),
    status: "ok",
    libraryPath: "/library/Author - Title.epub",
    epubSha256: "b".repeat(64),
    metadata: { title: "Title", authors: "Author" },
    ...overrides,
  };
}

let sql: Sql;
let store: BookStore;

async function setup() {
  sql = openTestSql();
  store = await BookStore.open(sql);
}

afterEach(async () => {
  await sql.close();
});

describe("reconcile", () => {
  it("inserts a row for a library file with no row", async () => {
    await setup();
    const host = new FakeHost();
    const path = "/library/Author - Title.epub";
    host.files.set(path, new Uint8Array([1]));
    host.hashes.set(path, "h1");
    host.metadata.set(path, {
      title: "Title",
      authors: "Author",
      uuid: "11111111-1111-1111-1111-111111111111",
    });

    const report = await reconcile(host, config(), store, install);

    expect(report.added).toBe(1);
    expect(report.problems).toEqual([]);
    const book = (await store.list())[0];
    expect(book.title).toBe("Title");
    expect(book.authors).toBe("Author");
    expect(book.libraryPath).toBe(path);
    expect(book.epubSha256).toBe("h1");
    expect(book.bookUuid).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("does nothing when the hash matches", async () => {
    await setup();
    const host = new FakeHost();
    const path = "/library/Author - Title.epub";
    host.files.set(path, new Uint8Array([1]));
    host.hashes.set(path, "h1");
    host.metadata.set(path, { title: "Title", authors: "Author" });

    await reconcile(host, config(), store, install);
    host.hashCalls = 0;
    const second = await reconcile(host, config(), store, install);

    expect(second.added).toBe(0);
    expect(second.refreshed).toBe(0);
    expect(host.hashCalls).toBe(0);
    expect(await store.list()).toHaveLength(1);
  });

  it("refreshes metadata for a stale file and keeps the pin", async () => {
    await setup();
    const host = new FakeHost();
    const path = "/library/Author - Title.epub";
    host.files.set(path, new Uint8Array([1]));
    host.hashes.set(path, "h1");
    host.metadata.set(path, { title: "Title", authors: "Author" });
    await reconcile(host, config(), store, install);
    const first = (await store.list())[0];
    await store.setPinned(first.id, true);
    host.files.set(`/home/covers/${first.id}.jpg`, new Uint8Array([4]));
    host.files.set(`/home/covers/${first.id}-full.jpg`, new Uint8Array([6]));

    host.files.set(path, new Uint8Array([1, 2]));
    host.hashes.set(path, "h2");
    host.metadata.set(path, { title: "New Title", authors: "New Author" });
    const report = await reconcile(host, config(), store, install);

    expect(report.refreshed).toBe(1);
    const book = (await store.get(first.id))!;
    expect(book.title).toBe("New Title");
    expect(book.epubSha256).toBe("h2");
    expect(book.pinned).toBe(true);
    expect(book.sourcePath).toBeNull();
    // The EPUB changed, so its old images must not be shown.
    expect(host.files.has(`/home/covers/${first.id}.jpg`)).toBe(false);
    expect(host.files.has(`/home/covers/${first.id}-full.jpg`)).toBe(false);
  });

  it("marks a discovered file without metadata as needing review", async () => {
    await setup();
    const host = new FakeHost();
    const path = "/library/Untitled.epub";
    host.files.set(path, new Uint8Array([1]));
    host.hashes.set(path, "h1");
    host.metadata.set(path, { title: "", authors: "" });

    const report = await reconcile(host, config(), store, install);

    expect(report.added).toBe(1);
    const book = (await store.list())[0];
    expect(book.status).toBe("needs_review");
    expect(book.flagReason).toBe("metadata_missing");
  });

  it("removes candidate covers that belong to no row", async () => {
    await setup();
    const candidates = emptyCandidates();
    candidates.covers.push({
      path: "candidates/live0000/itunes.jpg",
      source: "itunes",
      width: 100,
      height: 150,
    });
    await store.insert(
      outcome({ sha256: `live${"0".repeat(60)}`, candidates }),
    );
    const host = new FakeHost();
    host.dirs.add("/library");
    host.dirs.add("/home/candidates/live0000");
    host.files.set("/home/candidates/live0000/itunes.jpg", new Uint8Array([1]));
    host.dirs.add("/home/candidates/deadbeef");
    host.files.set("/home/candidates/deadbeef/itunes.jpg", new Uint8Array([2]));

    const report = await reconcile(host, config(), store, install);

    expect(report.removedCandidateDirs).toBe(1);
    expect(report.removedCandidateFiles).toBe(0);
    expect(host.files.has("/home/candidates/live0000/itunes.jpg")).toBe(true);
    expect(host.dirs.has("/home/candidates/live0000")).toBe(true);
    expect(host.dirs.has("/home/candidates/deadbeef")).toBe(false);
  });

  it("removes unreferenced images from an active candidate directory", async () => {
    await setup();
    const candidates = emptyCandidates();
    candidates.covers.push({
      path: "candidates/live0000/itunes.jpg",
      source: "itunes",
      width: 100,
      height: 150,
    });
    await store.insert(
      outcome({ sha256: `live${"0".repeat(60)}`, candidates }),
    );
    const host = new FakeHost();
    host.dirs.add("/library");
    host.dirs.add("/home/candidates/live0000");
    host.files.set("/home/candidates/live0000/itunes.jpg", new Uint8Array([1]));
    host.files.set(
      "/home/candidates/live0000/stale-abc.jpg",
      new Uint8Array([2]),
    );

    const report = await reconcile(host, config(), store, install);

    expect(report.removedCandidateFiles).toBe(1);
    expect(host.files.has("/home/candidates/live0000/itunes.jpg")).toBe(true);
    expect(host.files.has("/home/candidates/live0000/stale-abc.jpg")).toBe(
      false,
    );
  });

  it("reports a duplicate copy without a raw database error", async () => {
    await setup();
    await store.insert(
      outcome({
        bookUuid: "11111111-1111-1111-1111-111111111111",
        libraryPath: "/library/Original.epub",
      }),
    );
    const host = new FakeHost();
    const copy = "/library/Copy.epub";
    host.dirs.add("/library");
    host.files.set(copy, new Uint8Array([1]));
    host.hashes.set(copy, "h1");
    host.metadata.set(copy, {
      title: "Title",
      authors: "Author",
      uuid: "11111111-1111-1111-1111-111111111111",
    });

    const report = await reconcile(host, config(), store, install);

    expect(report.added).toBe(0);
    expect(report.problems[0]).toContain("duplicate copy of an existing book");
  });

  it("reports a missing calibre instead of guessing", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/Author - Title.epub", new Uint8Array([1]));

    const report = await reconcile(host, config(), store, null);

    expect(report.added).toBe(0);
    expect(report.problems[0]).toContain("calibre");
  });
});

describe("renaming the library", () => {
  it("plans a move for a stale name and leaves a matching one alone", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/old-name.epub", new Uint8Array([1]));
    host.files.set("/library/Author - Other.epub", new Uint8Array([2]));
    const stale = await store.insert(
      outcome({ libraryPath: "/library/old-name.epub" }),
    );
    await store.insert(
      outcome({
        sha256: "c".repeat(64),
        libraryPath: "/library/Author - Other.epub",
        metadata: { title: "Other", authors: "Author" },
      }),
    );

    const plan = await planLibraryRenames(
      host,
      config(),
      store,
      "{author} - {title}",
    );

    expect(plan.unchanged).toBe(1);
    expect(plan.moves).toEqual([
      {
        id: stale.id,
        title: "Title",
        from: "/library/old-name.epub",
        to: "/library/Author - Title.epub",
      },
    ]);
  });

  it("does not plan a rename for a missing file", async () => {
    await setup();
    const host = new FakeHost();
    host.dirs.add("/library");
    const book = await store.insert(
      outcome({ libraryPath: "/library/old-name.epub" }),
    );
    await store.setMissing(book.id, true);

    const plan = await planLibraryRenames(host, config(), store, "{title}");

    expect(plan.moves).toEqual([]);
    expect(plan.problems.join(" ")).toContain("file is missing");
  });

  it("renames the file and points the row at it", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/old-name.epub", new Uint8Array([1, 2, 3]));
    const book = await store.insert(
      outcome({ libraryPath: "/library/old-name.epub" }),
    );
    const plan = await planLibraryRenames(host, config(), store, "{title}");

    const report = await applyLibraryRenames(host, config(), store, plan);

    expect(report).toEqual({ renamed: 1, problems: [] });
    expect(host.files.has("/library/old-name.epub")).toBe(false);
    expect(host.files.has("/library/Title.epub")).toBe(true);
    expect(host.files.has("/home/rename-journal.json")).toBe(false);
    const updated = (await store.get(book.id))!;
    expect(updated.libraryPath).toBe("/library/Title.epub");
    expect(updated.fileSize).toBe(3);

    // The new path and stamp are stored together, so startup does not re-read it.
    host.hashCalls = 0;
    const after = await reconcile(host, config(), store, install);
    expect(after.added).toBe(0);
    expect(host.hashCalls).toBe(0);
  });

  it("swaps two names without one overwriting the other", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/A.epub", new Uint8Array([1]));
    host.files.set("/library/B.epub", new Uint8Array([2]));
    const first = await store.insert(
      outcome({
        sha256: "c".repeat(64),
        epubSha256: "d".repeat(64),
        libraryPath: "/library/A.epub",
        metadata: { title: "B", authors: "Author" },
      }),
    );
    const second = await store.insert(
      outcome({
        sha256: "e".repeat(64),
        epubSha256: "f".repeat(64),
        libraryPath: "/library/B.epub",
        metadata: { title: "A", authors: "Author" },
      }),
    );

    const plan = await planLibraryRenames(host, config(), store, "{title}");
    const report = await applyLibraryRenames(host, config(), store, plan);

    expect(report.renamed).toBe(2);
    expect([...(host.files.get("/library/A.epub") ?? [])]).toEqual([2]);
    expect([...(host.files.get("/library/B.epub") ?? [])]).toEqual([1]);
    expect((await store.get(first.id))?.libraryPath).toBe("/library/B.epub");
    expect((await store.get(second.id))?.libraryPath).toBe("/library/A.epub");
  });

  it("suffixes two books that want the same name", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/one.epub", new Uint8Array([1]));
    host.files.set("/library/two.epub", new Uint8Array([2]));
    await store.insert(
      outcome({
        libraryPath: "/library/one.epub",
        sha256: "c".repeat(64),
        epubSha256: "d".repeat(64),
      }),
    );
    await store.insert(
      outcome({
        libraryPath: "/library/two.epub",
        sha256: "e".repeat(64),
        epubSha256: "f".repeat(64),
      }),
    );

    const plan = await planLibraryRenames(host, config(), store, "{title}");

    expect(plan.moves.map((move) => move.to)).toEqual([
      "/library/Title.epub",
      "/library/Title [ffff].epub",
    ]);
  });

  it("never steals a name owned by a file with no row", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/old-name.epub", new Uint8Array([1]));
    host.files.set("/library/Title.epub", new Uint8Array([2]));
    await store.insert(outcome({ libraryPath: "/library/old-name.epub" }));

    const plan = await planLibraryRenames(host, config(), store, "{title}");

    expect(plan.moves[0].to).toMatch(
      /^\/library\/Title \[[0-9a-f]{4}\]\.epub$/u,
    );
  });

  it("skips a case-only difference", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/author - title.epub", new Uint8Array([1]));
    await store.insert(
      outcome({ libraryPath: "/library/author - title.epub" }),
    );

    const plan = await planLibraryRenames(
      host,
      config(),
      store,
      "{author} - {title}",
    );

    expect(plan.moves).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("finishes an interrupted rename on the next start", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({ libraryPath: "/library/old-name.epub" }),
    );
    host.files.set("/library/.tmp-rename-1-abc.epub", new Uint8Array([4, 5]));
    host.files.set(
      "/home/rename-journal.json",
      new TextEncoder().encode(
        JSON.stringify({
          moves: [
            {
              id: book.id,
              from: "/library/old-name.epub",
              to: "/library/Title.epub",
              tmp: "/library/.tmp-rename-1-abc.epub",
            },
          ],
        }),
      ),
    );

    const report = await startup(host, config(), store, install);

    expect(report.resumedRenames).toBe(1);
    expect(host.files.has("/library/Title.epub")).toBe(true);
    expect(host.files.has("/library/.tmp-rename-1-abc.epub")).toBe(false);
    expect(host.files.has("/home/rename-journal.json")).toBe(false);
    expect((await store.get(book.id))?.libraryPath).toBe("/library/Title.epub");
  });

  it("re-attaches a row when its file was renamed outside the app", async () => {
    await setup();
    const host = new FakeHost();
    host.files.set("/library/Renamed.epub", new Uint8Array([1]));
    host.hashes.set("/library/Renamed.epub", "h1");
    const book = await store.insert(
      outcome({
        libraryPath: "/library/Author - Title.epub",
        epubSha256: "h1",
      }),
    );

    const report = await reconcile(host, config(), store, install);

    expect(report.adopted).toBe(1);
    expect(report.added).toBe(0);
    expect(await store.list()).toHaveLength(1);
    expect((await store.get(book.id))?.libraryPath).toBe(
      "/library/Renamed.epub",
    );
  });
});

describe("startup", () => {
  it("backfills has_cover from an existing thumbnail", async () => {
    await setup();
    const host = new FakeHost();
    host.dirs.add("/library");
    const book = await store.insert(outcome());
    host.files.set(`/home/covers/${book.id}.jpg`, new Uint8Array([1]));

    await startup(host, config(), store, install);

    expect((await store.get(book.id))?.hasCover).toBe(true);
  });

  it("removes an old temp file left by a crashed write", async () => {
    await setup();
    const host = new FakeHost();
    host.dirs.add("/library");
    host.files.set("/library/.tmp-edit-123.epub", new Uint8Array([1]));

    await startup(host, config(), store, install);

    expect(host.files.has("/library/.tmp-edit-123.epub")).toBe(false);
  });

  it("flags a book whose file disappeared and clears it when restored", async () => {
    await setup();
    const host = new FakeHost();
    host.dirs.add("/library");
    const book = await store.insert(outcome({ fileSize: 1, fileMtimeMs: 0 }));
    host.files.set(book.libraryPath!, new Uint8Array([1]));

    await startup(host, config(), store, install);
    expect((await store.get(book.id))?.missing).toBe(false);

    host.files.delete(book.libraryPath!);
    const report = await startup(host, config(), store, install);
    expect(report.missingFiles).toBe(1);
    expect((await store.get(book.id))?.missing).toBe(true);

    host.files.set(book.libraryPath!, new Uint8Array([1]));
    await startup(host, config(), store, install);
    expect((await store.get(book.id))?.missing).toBe(false);
  });

  it("does not mass-mark books when the library folder is unavailable", async () => {
    await setup();
    const host = new FakeHost();
    // The row points at a file under /library, but the configured folder is
    // somewhere else and does not exist. The missing pass must stay out of it.
    const book = await store.insert(
      outcome({ libraryPath: "/library/gone.epub" }),
    );
    const cfg = { ...config(), libraryDir: "/missing-library" };

    const report = await startup(host, cfg, store, null);

    expect(report.missingFiles).toBe(0);
    expect(report.problems).toContain(
      "library folder is missing: /missing-library",
    );
    expect((await store.get(book.id))?.missing).toBe(false);
  });
});

describe("checkBookFile", () => {
  it("marks a vanished file and returns null", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(outcome());

    expect(await checkBookFile(host, store, book)).toBeNull();
    expect((await store.get(book.id))?.missing).toBe(true);
  });

  it("clears the flag when the file is back", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(outcome());
    await store.setMissing(book.id, true);
    host.files.set(book.libraryPath!, new Uint8Array([1]));
    const current = (await store.get(book.id))!;

    const found = await checkBookFile(host, store, current);

    expect(found?.missing).toBe(false);
    expect(found?.libraryPath).toBe(book.libraryPath);
  });
});

describe("removeBook", () => {
  it("deletes the library file, row, thumbnail, and candidates, but keeps the source and archive", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({
        sha256: "ab".repeat(32),
        archivedPath: "/originals/archived.epub",
      }),
    );
    host.files.set(book.libraryPath!, new Uint8Array([1]));
    host.files.set(book.archivedPath!, new Uint8Array([2]));
    host.files.set(book.sourcePath!, new Uint8Array([3]));
    host.files.set(`/home/covers/${book.id}.jpg`, new Uint8Array([4]));
    host.files.set(`/home/covers/${book.id}-full.jpg`, new Uint8Array([6]));
    host.dirs.add("/home/candidates/abababab");
    host.files.set("/home/candidates/abababab/itunes.jpg", new Uint8Array([5]));

    await removeBook(host, config(), store, book);

    expect(await store.get(book.id)).toBeNull();
    expect(host.files.has(book.libraryPath!)).toBe(false);
    expect(host.files.has(`/home/covers/${book.id}.jpg`)).toBe(false);
    expect(host.files.has(`/home/covers/${book.id}-full.jpg`)).toBe(false);
    expect(host.dirs.has("/home/candidates/abababab")).toBe(false);
    // Archive and source stay unless asked.
    expect(host.files.has(book.archivedPath!)).toBe(true);
    expect(host.files.has(book.sourcePath!)).toBe(true);
  });

  it("deletes the archived copy when asked", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({ archivedPath: "/originals/archived.epub" }),
    );
    host.files.set(book.libraryPath!, new Uint8Array([1]));
    host.files.set(book.archivedPath!, new Uint8Array([2]));

    await removeBook(host, config(), store, book, { deleteArchive: true });

    expect(host.files.has(book.archivedPath!)).toBe(false);
  });
});

describe("editBook", () => {
  it("replaces the EPUB, updates the row, and resolves needs_review", async () => {
    await setup();
    const host = new FakeHost();
    const initialCandidates = emptyCandidates();
    initialCandidates.covers.push({
      path: "candidates/aaaaaaaa/itunes.jpg",
      source: "itunes",
      width: 1000,
      height: 1500,
    });
    const book = await store.insert(
      outcome({
        status: "needs_review",
        flagReason: "metadata_missing",
        error: "old failure",
        metadata: { title: "Old", authors: "Old Author" },
        candidates: initialCandidates,
      }),
    );
    host.files.set(book.libraryPath!, new TextEncoder().encode("epub bytes"));
    host.files.set("/home/candidates/aaaaaaaa/itunes.jpg", new Uint8Array([7]));
    host.metadata.set(book.libraryPath!, {
      title: "Old",
      authors: "Old Author",
    });

    const candidates = emptyCandidates();
    candidates.fields.title.push({ value: "Other Title", source: "itunes" });

    const updated = await editBook(host, config(), store, install, book, {
      metadata: { title: "New Title", authors: "New Author" },
      candidates,
      reading: { status: "reading", notes: "  Halfway through  " },
    });

    expect(updated.title).toBe("New Title");
    expect(updated.authors).toBe("New Author");
    expect(updated.readStatus).toBe("reading");
    expect(updated.personalNotes).toBe("Halfway through");
    expect(updated.candidates.fields.title).toEqual([
      { value: "Other Title", source: "itunes" },
    ]);
    expect(updated.status).toBe("ok");
    expect(updated.flagReason).toBeNull();
    expect(updated.error).toBeNull();
    expect(updated.hasCover).toBe(true);
    expect(updated.libraryPath).toBe(book.libraryPath);
    expect(
      [...host.files.keys()].some((path) => path.includes(".tmp-edit-")),
    ).toBe(false);
    // The candidate cover was dropped from the new list, so its file is gone.
    expect(host.files.has("/home/candidates/aaaaaaaa/itunes.jpg")).toBe(false);
  });

  it("keeps app-only reading state when only metadata is edited", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({ metadata: { title: "Old", authors: "Old Author" } }),
    );
    await store.setReading(book.id, "finished", "Keep this note");
    const current = (await store.get(book.id))!;
    host.files.set(
      current.libraryPath!,
      new TextEncoder().encode("epub bytes"),
    );
    host.metadata.set(current.libraryPath!, {
      title: "Old",
      authors: "Old Author",
    });

    // No `reading` field: the sheet is not touching that state.
    const updated = await editBook(host, config(), store, install, current, {
      metadata: { title: "New Title", authors: "New Author" },
    });

    expect(updated.title).toBe("New Title");
    expect(updated.readStatus).toBe("finished");
    expect(updated.personalNotes).toBe("Keep this note");
  });

  it("creates a full cover on demand and reuses it", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({
        metadata: { title: "Title", authors: "Author" },
      }),
    );
    host.files.set(book.libraryPath!, new TextEncoder().encode("epub"));
    host.metadata.set(book.libraryPath!, {
      title: "Title",
      authors: "Author",
    });

    const first = await ensureFullCover(host, config(), install, book);
    expect(first).toBe(`/home/covers/${book.id}-full.jpg`);
    expect(host.files.has(first!)).toBe(true);

    const second = await ensureFullCover(host, config(), install, book);
    expect(second).toBe(first);
    expect([...host.files.keys()].some((path) => path.includes("full-"))).toBe(
      false,
    );
  });

  it("does not update the row when the EPUB write fails", async () => {
    await setup();
    const host = new FakeHost();
    host.writeFails = true;
    const book = await store.insert(
      outcome({
        status: "needs_review",
        flagReason: "metadata_missing",
        metadata: { title: "Old", authors: "Old Author" },
      }),
    );
    host.files.set(book.libraryPath!, new TextEncoder().encode("epub bytes"));
    host.metadata.set(book.libraryPath!, {
      title: "Old",
      authors: "Old Author",
    });

    await expect(
      editBook(host, config(), store, install, book, {
        metadata: { title: "New Title", authors: "New Author" },
      }),
    ).rejects.toThrow("Metadata write failed");

    const read = (await store.get(book.id))!;
    expect(read.title).toBe("Old");
    expect(read.status).toBe("needs_review");
    expect(
      [...host.files.keys()].some((path) => path.includes(".tmp-edit-")),
    ).toBe(false);
  });
});

/** iTunes and Open Library both match, with two downloadable covers. */
function respondWithCovers(host: FakeHost) {
  host.httpGet = async (url, destination) => {
    if (url.startsWith("https://itunes.apple.com/search?")) {
      host.files.set(
        destination,
        new TextEncoder().encode(
          JSON.stringify({
            results: [
              {
                trackName: "Title",
                artistName: "Author",
                artworkUrl100: "https://img.example/100x100bb.jpg",
              },
            ],
          }),
        ),
      );
      return { status: 200, contentType: "application/json" };
    }
    if (url.startsWith("https://openlibrary.org/search.json?")) {
      host.files.set(
        destination,
        new TextEncoder().encode(
          JSON.stringify({
            docs: [{ title: "Title", author_name: ["Author"], cover_i: 42 }],
          }),
        ),
      );
      return { status: 200, contentType: "application/json" };
    }
    if (
      url === "https://img.example/1000x1000bb.jpg" ||
      url.startsWith("https://covers.openlibrary.org/b/id/42-L.jpg")
    ) {
      host.files.set(destination, jpeg());
      return { status: 200, contentType: "image/jpeg" };
    }
    throw new Error(`unexpected ${url}`);
  };
}

describe("refreshBookMetadata", () => {
  it("returns provider values and candidates without writing anything", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(
      outcome({
        metadata: { title: "Title", authors: "Author", tags: "old" },
      }),
    );
    const bytes = new TextEncoder().encode("epub bytes");
    host.files.set(book.libraryPath!, bytes);
    host.metadata.set(book.libraryPath!, {
      title: "Title",
      authors: "Author",
      tags: "old",
    });
    host.fetchResult = {
      title: "Title",
      authors: "Author",
      tags: "new, extra",
      series: "The Series",
      seriesIndex: "2",
    };

    const result = await refreshBookMetadata(host, config(), install, book);

    expect(result.found).toBe(true);
    expect(result.metadata.series).toBe("The Series");
    expect(result.metadata.seriesIndex).toBe("2");
    // The file's tags win; the provider's become an alternative.
    expect(result.metadata.tags).toBe("old");
    expect(result.candidates.fields.tags).toEqual([
      { value: "old", source: "file" },
      { value: "new, extra", source: "google_openlibrary" },
    ]);
    // Reading must not touch the library file or the row.
    expect(host.files.get(book.libraryPath!)).toEqual(bytes);
    expect((await store.get(book.id))?.series).toBeNull();
  });

  it("downloads and stores cover candidates when covers are enabled", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(outcome());
    host.files.set(book.libraryPath!, new TextEncoder().encode("epub"));
    host.metadata.set(book.libraryPath!, {
      title: "Title",
      authors: "Author",
    });
    host.fetchResult = { title: "Title", authors: "Author" };
    respondWithCovers(host);

    const result = await refreshBookMetadata(host, config(), install, book);

    expect(result.candidates.covers).toHaveLength(2);
    const stored = [...host.files.keys()].filter((path) =>
      path.startsWith("/home/candidates/aaaaaaaa/"),
    );
    expect(stored.some((path) => path.includes("/itunes-"))).toBe(true);
    expect(stored.some((path) => path.includes("/open_library-"))).toBe(true);
    // Still a read: the row is unchanged until the user saves.
    expect((await store.get(book.id))?.candidates.covers).toEqual([]);
  });

  it("keeps a cover-only refresh out of the metadata candidates", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(outcome());
    host.files.set(book.libraryPath!, new TextEncoder().encode("epub"));
    host.metadata.set(book.libraryPath!, {
      title: "Title",
      authors: "Author",
    });
    respondWithCovers(host);

    const result = await refreshBookMetadata(
      host,
      { ...config(), fetchMetadata: false },
      install,
      book,
    );

    // No metadata provider values leaked; the covers are the only new result.
    expect(result.found).toBe(true);
    const sources = new Set(
      Object.values(result.candidates.fields)
        .flat()
        .map((candidate) => candidate.source),
    );
    expect(sources).toEqual(new Set(["file"]));
    expect(result.candidates.covers).toHaveLength(2);
  });
});

describe("readCoverSize", () => {
  it("measures the extracted file cover and cleans up the temp image", async () => {
    await setup();
    const host = new FakeHost();
    const book = await store.insert(outcome());
    host.files.set(book.libraryPath!, new Uint8Array([1]));
    host.metadata.set(book.libraryPath!, {
      title: "Title",
      authors: "Author",
    });

    const size = await readCoverSize(host, config(), install, book);

    expect(size).toEqual({ width: 1200, height: 1800 });
    expect(
      [...host.files.keys()].some((path) => path.includes("coversize-")),
    ).toBe(false);
  });
});

describe("pinning", () => {
  it("sets and clears the pin", async () => {
    await setup();
    const book = await store.insert(outcome());
    await store.setPinned(book.id, true);
    const pinned = (await store.get(book.id))!;
    expect(pinned.pinned).toBe(true);
    expect(pinned.pinnedOrder).toBeGreaterThan(0);

    await store.setPinned(book.id, false);
    const cleared = (await store.get(book.id))!;
    expect(cleared.pinned).toBe(false);
    expect(cleared.pinnedOrder).toBeNull();
  });
});

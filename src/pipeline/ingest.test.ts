import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "./config";
import { BookStore, type Sql } from "./db";
import type { FileStat, Host, HttpResult, ProcessResult } from "./host";
import { ingestFile } from "./ingest";
import { openTestSql } from "./test-sql";

type FakeMetadata = { title: string; authors: string };

const install = { dir: "C:\\Calibre", version: "9.18" };

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function opf(metadata: FakeMetadata): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${metadata.title}</dc:title>
    <dc:creator opf:file-as="Author">${metadata.authors}</dc:creator>
  </metadata>
</package>`;
}

/** A minimal but valid EPUB: container → OPF → title, author, UUID. */
function sourceEpub(): Uint8Array {
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  const content = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Title</dc:title>
    <dc:creator>Author</dc:creator>
    <dc:identifier opf:scheme="uuid">urn:uuid:11111111-1111-1111-1111-111111111111</dc:identifier>
  </metadata>
</package>`;
  return zipSync(
    {
      mimetype: enc("application/epub+zip"),
      "META-INF/container.xml": enc(container),
      "content.opf": enc(content),
    },
    { level: 0 },
  );
}

/**
 * An in-memory Host with just enough calibre to exercise the orchestration.
 * No process is spawned and no request leaves the test.
 */
class IngestHost implements Host {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  metadata = new Map<string, FakeMetadata>();
  writeFails = false;
  convertedEpub: Uint8Array | null = null;

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return bytes;
  }

  async writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) throw new Error(`ENOENT ${from}`);
    this.files.set(to, bytes);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) throw new Error(`ENOENT ${from}`);
    if (this.files.has(to)) throw new Error(`will not overwrite ${to}`);
    this.files.delete(from);
    this.files.set(to, bytes);
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
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return createHash("sha256").update(bytes).digest("hex");
  }

  async runProcess(program: string, args: string[]): Promise<ProcessResult> {
    const lower = program.toLowerCase();
    if (lower.includes("ebook-convert")) {
      if (this.convertedEpub) {
        this.files.set(args[1], this.convertedEpub);
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      }
      return {
        code: 1,
        stdout: "",
        stderr: "convert boom",
        timedOut: false,
      };
    }
    if (!lower.includes("ebook-meta")) {
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }

    const opfIndex = args.indexOf("--to-opf");
    if (opfIndex >= 0) {
      const epub = args[0];
      const target = args[opfIndex + 1];
      const meta = this.metadata.get(epub) ?? {
        title: "Title",
        authors: "Author",
      };
      this.files.set(target, enc(opf(meta)));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }

    if (args.includes("--get-cover")) {
      return { code: 1, stdout: "", stderr: "no cover", timedOut: false };
    }
    if (this.writeFails) {
      return { code: 1, stdout: "", stderr: "write boom", timedOut: false };
    }

    const title = args[args.indexOf("--title") + 1] ?? "";
    const authors = args[args.indexOf("--authors") + 1] ?? "";
    this.metadata.set(args[0], { title, authors });
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  async httpGet(
    _url: string,
    _destination: string,
    _timeoutMs: number,
  ): Promise<HttpResult> {
    throw new Error("network is not used in ingest tests");
  }

  env(_name: string): string | undefined {
    return undefined;
  }
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    homeDir: "/home",
    libraryDir: "/library",
    archiveOriginals: false,
    originalsDir: "/originals",
    fetchMetadata: false,
    cleanConverted: false,
    fetchCovers: false,
    calibreDir: null,
    sortBy: "author",
    fileNameTemplate: "{author} - {title}",
    ...overrides,
  };
}

function libraryFiles(host: IngestHost): string[] {
  return [...host.files.keys()].filter((path) => path.startsWith("/library/"));
}

let sql: Sql;
let store: BookStore;

beforeEach(async () => {
  sql = openTestSql();
  store = await BookStore.open(sql);
});

afterEach(async () => {
  await sql.close();
});

describe("ingestFile", () => {
  it("files a dropped EPUB without touching the source", async () => {
    const host = new IngestHost();
    const source = "/drop/source.epub";
    host.files.set(source, sourceEpub());

    const outcome = await ingestFile(host, config(), source, {
      install,
      store,
    });

    expect(outcome.status).toBe("ok");
    expect(outcome.duplicate).toBeUndefined();
    expect(outcome.libraryPath).toBe("/library/Author - Title.epub");
    expect(host.files.has(source)).toBe(true);
    expect(libraryFiles(host)).toEqual(["/library/Author - Title.epub"]);

    const row = (await store.get(outcome.book!.id))!;
    expect(row.title).toBe("Title");
    expect(row.authors).toBe("Author");
    expect(row.status).toBe("ok");
    expect(row.sha256).toHaveLength(64);
    expect(row.epubSha256).toHaveLength(64);
    expect(row.bookUuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(
      [...host.files.keys()].some((path) => path.startsWith("/home/tmp/")),
    ).toBe(false);
  });

  it("stops a duplicate without a second row or file", async () => {
    const host = new IngestHost();
    const source = "/drop/source.epub";
    host.files.set(source, sourceEpub());

    const first = await ingestFile(host, config(), source, {
      install,
      store,
    });
    const second = await ingestFile(host, config(), source, {
      install,
      store,
    });

    expect(second.duplicate).toBe(true);
    expect(second.book?.id).toBe(first.book?.id);
    expect(await store.list()).toHaveLength(1);
    expect(libraryFiles(host)).toHaveLength(1);
  });

  it("records an unreadable EPUB as flagged", async () => {
    const host = new IngestHost();
    const source = "/drop/broken.epub";
    host.files.set(source, enc("not a zip"));

    const outcome = await ingestFile(host, config(), source, {
      install,
      store,
    });

    expect(outcome.status).toBe("flagged");
    expect(outcome.flagReason).toBe("unreadable");
    expect(outcome.libraryPath).toBeUndefined();
    expect(await store.list()).toHaveLength(1);
    expect(libraryFiles(host)).toHaveLength(0);
  });

  it("records a conversion failure as flagged", async () => {
    const host = new IngestHost();
    const source = "/drop/book.txt";
    host.files.set(source, enc("hello"));

    const outcome = await ingestFile(host, config(), source, {
      install,
      store,
    });

    expect(outcome.status).toBe("flagged");
    expect(outcome.flagReason).toBe("convert_failed");
    expect(outcome.error).toContain("convert boom");
    expect(libraryFiles(host)).toHaveLength(0);
  });

  it("files a converted EPUB when cleaning fails", async () => {
    const host = new IngestHost();
    const source = "/drop/book.txt";
    host.files.set(source, enc("hello"));
    host.convertedEpub = zipSync(
      {
        mimetype: enc("application/epub+zip"),
        "chapter.xhtml": enc(
          `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>broken`,
        ),
      },
      { level: 0 },
    );

    const outcome = await ingestFile(
      host,
      config({ cleanConverted: true }),
      source,
      { install, store },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.cleanWarning).toContain("not cleaned");
    expect(outcome.libraryPath).toBeDefined();
    expect(libraryFiles(host)).toHaveLength(1);
  });

  it("files the book as needs_review when the metadata write fails", async () => {
    const host = new IngestHost();
    host.writeFails = true;
    const source = "/drop/source.epub";
    host.files.set(source, sourceEpub());

    const outcome = await ingestFile(host, config(), source, {
      install,
      store,
    });

    expect(outcome.status).toBe("needs_review");
    expect(outcome.error).toContain("metadata write failed");
    expect(outcome.libraryPath).toBe("/library/Author - Title.epub");
    expect(libraryFiles(host)).toHaveLength(1);
    expect((await store.get(outcome.book!.id))?.status).toBe("needs_review");
  });

  it("archives the source when asked", async () => {
    const host = new IngestHost();
    const source = "/drop/source.epub";
    host.files.set(source, sourceEpub());

    const outcome = await ingestFile(
      host,
      config({ archiveOriginals: true }),
      source,
      { install, store },
    );

    expect(outcome.archivedPath).toBeDefined();
    expect(
      [...host.files.keys()].some((path) => path.startsWith("/originals/")),
    ).toBe(true);
  });
});

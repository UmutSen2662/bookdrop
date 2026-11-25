import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BookStore, type Sql, toSqlxPlaceholders } from "@/pipeline/db";
import { openTestSql } from "@/pipeline/test-sql";
import { emptyCandidates, type IngestOutcome } from "@/pipeline/types";

function outcome(overrides: Partial<IngestOutcome> = {}): IngestOutcome {
  return {
    sourcePath: "C:/drop/book.epub",
    sha256: "a".repeat(64),
    status: "ok",
    libraryPath: "C:/library/Author - Title.epub",
    epubSha256: "b".repeat(64),
    metadata: {
      title: "Title",
      authors: "First Author",
      authorSort: "Author, First",
      isbn: "9781234567897",
      description: "<p>Desc</p>",
      tags: "fantasy, romance",
      series: "The Series",
      seriesIndex: "2",
    },
    ...overrides,
  };
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

describe("toSqlxPlaceholders", () => {
  it("numbers ? placeholders for tauri-plugin-sql", () => {
    expect(
      toSqlxPlaceholders("SELECT * FROM books WHERE id = ? AND title = ?"),
    ).toBe("SELECT * FROM books WHERE id = $1 AND title = $2");
    expect(toSqlxPlaceholders("PRAGMA user_version")).toBe(
      "PRAGMA user_version",
    );
  });
});

describe("migrate", () => {
  it("finishes a migration that a crash left half-applied", async () => {
    // The columns already exist, but user_version points at the previous
    // migration, as it would after a crash between two ALTER statements.
    await sql.execute("PRAGMA user_version = 1");

    await expect(BookStore.open(sql)).resolves.toBeDefined();

    const rows = await sql.select<{ user_version: number }>(
      "PRAGMA user_version",
    );
    expect(Number(rows[0].user_version)).toBeGreaterThan(1);
  });
});

describe("BookStore", () => {
  it("stores a row and returns it with camelCase fields", async () => {
    const book = await store.insert(outcome());

    expect(book.id).toBeGreaterThan(0);
    expect(book.title).toBe("Title");
    expect(book.authors).toBe("First Author");
    expect(book.authorSort).toBe("Author, First");
    expect(book.status).toBe("ok");
    expect(book.pinned).toBe(false);
    expect(book.sha256).toBe("a".repeat(64));
    expect(book.series).toBe("The Series");
    expect(book.seriesIndex).toBe("2");
    expect(book.tags).toBe("fantasy, romance");
    expect(book.hasCover).toBe(false);
    expect(book.libraryPath).toBe("C:/library/Author - Title.epub");
    expect(book.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips the candidates blob", async () => {
    const candidates = emptyCandidates();
    candidates.fields.title.push(
      { value: "Title", source: "file" },
      { value: "Title: Subtitle", source: "google_openlibrary" },
    );
    candidates.covers.push({
      path: "candidates/aaaaaaaa/itunes.jpg",
      source: "itunes",
      width: 1000,
      height: 1500,
    });

    const book = await store.insert(outcome({ candidates }));
    const read = await store.get(book.id);

    expect(read?.candidates.fields.title).toHaveLength(2);
    expect(read?.candidates.fields.title[1]).toEqual({
      value: "Title: Subtitle",
      source: "google_openlibrary",
    });
    expect(read?.candidates.covers[0].width).toBe(1000);
  });

  it("keeps a flagged row without a library path", async () => {
    const book = await store.insert(
      outcome({
        status: "flagged",
        flagReason: "drm",
        libraryPath: undefined,
        epubSha256: undefined,
        metadata: undefined,
        error: "encrypted",
      }),
    );

    expect(book.status).toBe("flagged");
    expect(book.flagReason).toBe("drm");
    expect(book.libraryPath).toBeNull();
    expect(book.error).toBe("encrypted");
  });

  it("allows several rows with no source hash", async () => {
    await store.insert(
      outcome({ sha256: "", status: "flagged", flagReason: "unreadable" }),
    );
    await store.insert(
      outcome({ sha256: "", status: "flagged", flagReason: "unreadable" }),
    );
    expect((await store.counts()).total).toBe(2);
  });

  it("finds a duplicate by source hash, library hash, or uuid", async () => {
    await store.insert(
      outcome({ bookUuid: "11111111-1111-1111-1111-111111111111" }),
    );

    expect(await store.findDuplicate("a".repeat(64))).not.toBeNull();
    expect(await store.findDuplicate("b".repeat(64))).not.toBeNull();
    expect(
      await store.findDuplicate(
        "c".repeat(64),
        "11111111-1111-1111-1111-111111111111",
      ),
    ).not.toBeNull();
    expect(await store.findDuplicate("c".repeat(64))).toBeNull();
  });

  it("prefers an ok duplicate over a flagged one", async () => {
    await store.insert(
      outcome({
        status: "flagged",
        flagReason: "drm",
        sha256: "f".repeat(64),
        bookUuid: "33333333-3333-3333-3333-333333333333",
      }),
    );
    const ok = await store.insert(
      outcome({
        sha256: "a".repeat(64),
        bookUuid: "44444444-4444-4444-4444-444444444444",
      }),
    );

    // Matches the flagged row by hash and the ok row by uuid.
    const found = await store.findDuplicate("f".repeat(64), ok.bookUuid);
    expect(found?.status).toBe("ok");
  });

  it("matches a library path without regard to case", async () => {
    await store.insert(outcome());
    expect(
      await store.findByLibraryPath("c:/LIBRARY/author - title.EPUB"),
    ).not.toBeNull();
  });

  it("sorts pinned first, then by author, with authorless books last", async () => {
    await store.insert(
      outcome({
        sha256: "1".repeat(64),
        metadata: { title: "Zed", authors: "Zulu", authorSort: "Zulu" },
      }),
    );
    await store.insert(
      outcome({
        sha256: "2".repeat(64),
        metadata: { title: "Alpha", authors: "Able", authorSort: "Able" },
      }),
    );
    await store.insert(
      outcome({
        sha256: "3".repeat(64),
        metadata: { title: "No Author", authors: "" },
      }),
    );
    const pinned = await store.insert(
      outcome({
        sha256: "4".repeat(64),
        metadata: { title: "Pinned", authors: "Zulu", authorSort: "Zulu" },
      }),
    );
    await store.setPinned(pinned.id, true);

    const books = await store.list();
    expect(books.map((book) => book.title)).toEqual([
      "Pinned",
      "Alpha",
      "Zed",
      "No Author",
    ]);
  });

  it("reorders the pinned zone", async () => {
    const a = await store.insert(
      outcome({
        sha256: "5".repeat(64),
        metadata: { title: "A", authors: "A", authorSort: "A" },
      }),
    );
    const b = await store.insert(
      outcome({
        sha256: "6".repeat(64),
        metadata: { title: "B", authors: "B", authorSort: "B" },
      }),
    );
    const c = await store.insert(
      outcome({
        sha256: "7".repeat(64),
        metadata: { title: "C", authors: "C", authorSort: "C" },
      }),
    );
    await store.setPinned(a.id, true);
    await store.setPinned(b.id, true);
    await store.setPinned(c.id, true);

    await store.reorderPinned([b.id, c.id, a.id]);

    const books = await store.list();
    expect(books.map((book) => book.title)).toEqual(["B", "C", "A"]);
  });

  it("updates an edited book and resolves needs_review", async () => {
    const book = await store.insert(
      outcome({
        status: "needs_review",
        flagReason: "metadata_missing",
        error: "old failure",
      }),
    );

    const candidates = emptyCandidates();
    candidates.fields.description.push({
      value: "Kept alternative",
      source: "itunes",
    });

    await store.updateEdited(
      book.id,
      {
        title: "New Title",
        authors: "New Author",
        authorSort: "Author, New",
        description: "<p>New</p>",
      },
      "c".repeat(64),
      true,
      { status: "reading", notes: "Halfway there" },
      candidates,
    );

    const read = (await store.get(book.id))!;
    expect(read.title).toBe("New Title");
    expect(read.authors).toBe("New Author");
    expect(read.authorSort).toBe("Author, New");
    expect(read.epubSha256).toBe("c".repeat(64));
    expect(read.status).toBe("ok");
    expect(read.flagReason).toBeNull();
    expect(read.error).toBeNull();
    expect(read.readStatus).toBe("reading");
    expect(read.personalNotes).toBe("Halfway there");
    expect(read.candidates.fields.description).toEqual([
      { value: "Kept alternative", source: "itunes" },
    ]);
  });

  it("removes a row", async () => {
    const book = await store.insert(outcome());
    await store.remove(book.id);
    expect(await store.get(book.id)).toBeNull();
  });

  it("clears series and tags when an edit removes them", async () => {
    const book = await store.insert(outcome());
    await store.updateEdited(
      book.id,
      { title: "Title", authors: "First Author" },
      "c".repeat(64),
      false,
      { status: "unread", notes: null },
    );

    const read = await store.get(book.id);
    expect(read?.series).toBeNull();
    expect(read?.seriesIndex).toBeNull();
    expect(read?.tags).toBeNull();
  });

  it("records whether a cover image exists", async () => {
    const book = await store.insert(outcome());
    expect(book.hasCover).toBe(false);

    await store.setHasCover(book.id, true);
    expect((await store.get(book.id))?.hasCover).toBe(true);

    await store.setHasCover(book.id, false);
    expect((await store.get(book.id))?.hasCover).toBe(false);
  });

  it("starts every row as unread with no personal notes", async () => {
    const book = await store.insert(outcome());
    expect(book.readStatus).toBe("unread");
    expect(book.personalNotes).toBeNull();
  });

  it("saves reading state on its own", async () => {
    const book = await store.insert(outcome());
    await store.setReading(book.id, "finished", "Loved the ending");

    const read = await store.get(book.id);
    expect(read?.readStatus).toBe("finished");
    expect(read?.personalNotes).toBe("Loved the ending");

    await store.setReading(book.id, "unread", null);
    expect((await store.get(book.id))?.personalNotes).toBeNull();
  });

  it("refreshes metadata but keeps pin and candidates", async () => {
    const candidates = emptyCandidates();
    candidates.fields.title.push({ value: "Old", source: "file" });
    const book = await store.insert(outcome({ candidates }));
    await store.setPinned(book.id, true);

    await store.refreshFromEpub(book.id, {
      sha256: book.sha256,
      epubSha256: "c".repeat(64),
      libraryPath: book.libraryPath!,
      metadata: { title: "New", authors: "Someone Else" },
    });

    const read = await store.get(book.id);
    expect(read?.title).toBe("New");
    expect(read?.epubSha256).toBe("c".repeat(64));
    expect(read?.pinned).toBe(true);
    expect(read?.candidates.fields.title[0].value).toBe("Old");
  });
});

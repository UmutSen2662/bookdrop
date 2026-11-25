import { describe, expect, it } from "vitest";
import { notesExportFileName, notesExportJson } from "@/pipeline/notes";
import { makeBook } from "@/pipeline/test-book";
import type { Book } from "@/pipeline/types";

function book(overrides: Partial<Book> = {}): Book {
  return makeBook({
    bookUuid: "uuid-1",
    sha256: "sha-1",
    epubSha256: "epub-1",
    sourcePath: "C:\\drop\\a.epub",
    libraryPath: "C:\\library\\a.epub",
    title: "A",
    authors: "Author",
    ...overrides,
  });
}

describe("notesExportJson", () => {
  it("exports identifiers, reading status, and notes, not paths", () => {
    const text = notesExportJson(
      [book({ readStatus: "reading", personalNotes: "Great ending" })],
      new Date("2026-11-23T10:00:00.000Z"),
    );
    const data = JSON.parse(text);

    expect(data).toEqual({
      format: "bookdrop-notes",
      version: 1,
      exportedAt: "2026-11-23T10:00:00.000Z",
      books: [
        {
          bookUuid: "uuid-1",
          sha256: "sha-1",
          epubSha256: "epub-1",
          title: "A",
          authors: "Author",
          readStatus: "reading",
          personalNotes: "Great ending",
        },
      ],
    });
    expect(text).not.toContain("library");
  });

  it("keeps an empty library as a valid export", () => {
    const data = JSON.parse(notesExportJson([], new Date()));
    expect(data.books).toEqual([]);
  });
});

describe("notesExportFileName", () => {
  it("names the file by export date", () => {
    expect(notesExportFileName(new Date("2026-11-23T10:00:00.000Z"))).toBe(
      "bookdrop-notes-2026-11-23.json",
    );
  });
});

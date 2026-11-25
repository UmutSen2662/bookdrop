import { describe, expect, it } from "vitest";
import { shareEntries } from "@/lib/opds";
import { makeBook } from "@/pipeline/test-book";
import type { Book } from "@/pipeline/types";

function book(overrides: Partial<Book> = {}): Book {
  return makeBook({
    sha256: "drop-hash",
    fileSize: 1024,
    fileMtimeMs: 1,
    title: "Dune",
    authors: "Frank Herbert",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...overrides,
  });
}

const HOME = "C:\\data\\bookdrop";

describe("shareEntries", () => {
  it("includes readable books, reviewed or not", () => {
    const entries = shareEntries(
      [
        book(),
        book({ id: 2, title: "Emma", status: "needs_review" }),
        book({ id: 3, title: "Broken", status: "flagged", libraryPath: null }),
        book({ id: 4, title: "Gone", missing: true }),
      ],
      HOME,
    );

    expect(entries.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("keeps the absolute file path and name the server needs", () => {
    const [entry] = shareEntries([book()], HOME);

    expect(entry?.filePath).toBe("C:\\library\\Dune.epub");
    expect(entry?.fileName).toBe("Dune.epub");
    expect(entry?.fileSize).toBe(1024);
    expect(entry?.updatedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("falls back to the file name and an author placeholder", () => {
    const [entry] = shareEntries(
      [
        book({
          title: "   ",
          authors: "",
          libraryPath: "C:\\library\\the_dune.epub",
        }),
      ],
      HOME,
    );

    expect(entry?.title).toBe("the_dune");
    expect(entry?.authors).toBe("Unknown author");
  });

  it("only points at a cover when the book has one and the home is known", () => {
    const [withCover] = shareEntries([book({ id: 7, hasCover: true })], HOME);
    expect(withCover?.coverPath).toBe("C:\\data\\bookdrop\\covers\\7.jpg");

    const [withoutCover] = shareEntries([book({ hasCover: false })], HOME);
    expect(withoutCover?.coverPath).toBeNull();

    const [noHome] = shareEntries([book({ hasCover: true })], "");
    expect(noHome?.coverPath).toBeNull();
  });

  it("turns HTML descriptions into plain text and trims them", () => {
    const [short] = shareEntries(
      [book({ description: "<p>Arrakis &amp; spice.</p>" })],
      HOME,
    );
    expect(short?.description).toBe("Arrakis & spice.");

    const [long] = shareEntries(
      [book({ description: `<p>${"a".repeat(900)}</p>` })],
      HOME,
    );
    expect(long?.description).toHaveLength(800);
  });

  it("omits blank descriptions rather than sending empty content", () => {
    const [entry] = shareEntries([book({ description: "  <p></p> " })], HOME);
    expect(entry?.description).toBeNull();
  });
});

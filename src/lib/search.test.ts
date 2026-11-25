import { describe, expect, it } from "vitest";
import { bookMatches, parseQuery } from "@/lib/search";
import { makeBook } from "@/pipeline/test-book";
import type { Book } from "@/pipeline/types";

function book(overrides: Partial<Book> = {}): Book {
  return makeBook({
    title: "She Drives Me Crazy",
    authors: "Kelly Quindlen",
    authorSort: "Quindlen, Kelly",
    tags: "Young Adult, Romance",
    series: "She Drives Me Crazy",
    seriesIndex: "1",
    hasCover: true,
    libraryPath: null,
    addedAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    ...overrides,
  });
}

describe("parseQuery", () => {
  it("splits on whitespace and normalizes", () => {
    expect(parseQuery("  She   DRIVES ")).toEqual([
      { field: null, term: "she" },
      { field: null, term: "drives" },
    ]);
  });

  it("reads author:, title:, series:, and tag: prefixes", () => {
    expect(parseQuery("author:kelly title:crazy")).toEqual([
      { field: "author", term: "kelly" },
      { field: "title", term: "crazy" },
    ]);
    expect(parseQuery("series:crazy tag:romance")).toEqual([
      { field: "series", term: "crazy" },
      { field: "tag", term: "romance" },
    ]);
  });

  it("treats an unknown prefix as plain text", () => {
    expect(parseQuery("foo:bar")).toEqual([
      { field: null, term: "foo" },
      { field: null, term: "bar" },
    ]);
  });

  it("strips punctuation and diacritics", () => {
    expect(parseQuery("Imogen, Obviously")).toEqual([
      { field: null, term: "imogen" },
      { field: null, term: "obviously" },
    ]);
    expect(parseQuery("Brontë")).toEqual([{ field: null, term: "bronte" }]);
  });
});

describe("bookMatches", () => {
  const target = book();

  it("matches word prefixes on title and author", () => {
    expect(bookMatches(target, parseQuery("quindl"))).toBe(true);
    expect(bookMatches(target, parseQuery("drives cr"))).toBe(true);
    expect(bookMatches(target, parseQuery("she kelly"))).toBe(true);
  });

  it("requires every token (AND)", () => {
    expect(bookMatches(target, parseQuery("she quindlen"))).toBe(true);
    expect(bookMatches(target, parseQuery("she albertalli"))).toBe(false);
  });

  it("does not match a raw substring inside a word", () => {
    expect(bookMatches(target, parseQuery("razy"))).toBe(false);
  });

  it("narrows with author: and title:", () => {
    expect(bookMatches(target, parseQuery("author:quind"))).toBe(true);
    expect(bookMatches(target, parseQuery("author:she"))).toBe(false);
    expect(bookMatches(target, parseQuery("title:crazy"))).toBe(true);
    expect(bookMatches(target, parseQuery("title:kelly"))).toBe(false);
  });

  it("matches series and tags, in general and by prefix", () => {
    expect(bookMatches(target, parseQuery("series:drives"))).toBe(true);
    expect(bookMatches(target, parseQuery("tag:romanc"))).toBe(true);
    expect(bookMatches(target, parseQuery("romance"))).toBe(true);
    expect(bookMatches(target, parseQuery("series:quindlen"))).toBe(false);
    expect(bookMatches(target, parseQuery("tag:fantasy"))).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(bookMatches(target, parseQuery(""))).toBe(true);
  });
});

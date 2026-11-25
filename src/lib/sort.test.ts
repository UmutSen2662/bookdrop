import { describe, expect, it } from "vitest";
import { sortBooks } from "@/lib/sort";
import { makeBook } from "@/pipeline/test-book";
import type { Book } from "@/pipeline/types";

function book(overrides: Partial<Book> = {}): Book {
  const base = makeBook({
    title: "Title",
    authors: "Author",
    authorSort: "Author",
    titleSort: "Title",
    ...overrides,
  });
  // Most tests set only `title`; give them a matching derived sort title.
  if (overrides.title !== undefined && overrides.titleSort === undefined) {
    base.titleSort = overrides.title;
  }
  return base;
}

describe("sortBooks", () => {
  it("sorts by author and puts authorless books last", () => {
    const books = [
      book({ title: "Zed", authors: "Zulu", authorSort: "Zulu" }),
      book({ title: "No Author", authors: "", authorSort: null }),
      book({ title: "Alpha", authors: "Able", authorSort: "Able" }),
    ];
    expect(sortBooks(books, "author").map((entry) => entry.title)).toEqual([
      "Alpha",
      "Zed",
      "No Author",
    ]);
  });

  it("sorts by title using the derived sort title", () => {
    const books = [
      book({ title: "The Hobbit", titleSort: "Hobbit, The" }),
      book({ title: "Alpha", titleSort: "Alpha" }),
      book({ title: "Zebra", titleSort: "Zebra" }),
    ];
    expect(sortBooks(books, "title").map((entry) => entry.title)).toEqual([
      "Alpha",
      "The Hobbit",
      "Zebra",
    ]);
  });

  it("sorts recently added newest first", () => {
    const books = [
      book({ title: "Old", addedAt: "2025-01-01T00:00:00.000Z" }),
      book({ title: "New", addedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(sortBooks(books, "added").map((entry) => entry.title)).toEqual([
      "New",
      "Old",
    ]);
  });

  it("sorts published newest first and puts undated books last", () => {
    const books = [
      book({ title: "Undated" }),
      book({ title: "2020", published: "2020-01-01" }),
      book({ title: "2024", published: "2024-01-01" }),
    ];
    expect(sortBooks(books, "published").map((entry) => entry.title)).toEqual([
      "2024",
      "2020",
      "Undated",
    ]);
  });

  it("sorts by series, then numeric index, with standalones last", () => {
    const books = [
      book({ title: "Standalone" }),
      book({ title: "Second", series: "Saga", seriesIndex: "2" }),
      book({ title: "First", series: "Saga", seriesIndex: "1" }),
      book({ title: "Tenth", series: "Saga", seriesIndex: "10" }),
      book({ title: "Other", series: "Another", seriesIndex: "1" }),
    ];
    expect(sortBooks(books, "series").map((entry) => entry.title)).toEqual([
      "Other",
      "First",
      "Second",
      "Tenth",
      "Standalone",
    ]);
  });

  it("does not mutate the input array", () => {
    const books = [book({ title: "B" }), book({ title: "A" })];
    const sorted = sortBooks(books, "title");
    expect(books.map((entry) => entry.title)).toEqual(["B", "A"]);
    expect(sorted.map((entry) => entry.title)).toEqual(["A", "B"]);
  });
});

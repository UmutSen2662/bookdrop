import { describe, expect, it } from "vitest";
import { canonicalTags, parseTags, serializeTags } from "./tags";

describe("parseTags", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseTags(" fantasy, romance ,, ")).toEqual(["fantasy", "romance"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("canonicalTags", () => {
  it("dedupes without regard to case and sorts alphabetically", () => {
    expect(
      canonicalTags(["Romance", "fantasy", "romance", "  Fantasy ", ""]),
    ).toEqual(["fantasy", "Romance"]);
  });

  it("keeps the first spelling of a duplicate", () => {
    expect(canonicalTags(["LGBTQ+", "lgbtq+"])).toEqual(["LGBTQ+"]);
  });

  it("removes commas from individual tags", () => {
    expect(canonicalTags(["science, fiction"])).toEqual(["science fiction"]);
  });
});

describe("serializeTags", () => {
  it("writes the comma-separated form calibre expects", () => {
    expect(serializeTags(["Romance", "fantasy", "fantasy"])).toBe(
      "fantasy, Romance",
    );
    expect(serializeTags([])).toBe("");
  });
});

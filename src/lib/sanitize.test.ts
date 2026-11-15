import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("strips tags and escapes text when there is no DOM", () => {
    expect(sanitizeHtml("<p>Hi</p><script>alert(1)</script>")).toBe("Hi");
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">Tom & Jerry')).toBe(
      "Tom &amp; Jerry",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });
});

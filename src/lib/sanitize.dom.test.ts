// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";

describe("sanitizeHtml (DOM)", () => {
  it("keeps the allowed formatting", () => {
    expect(sanitizeHtml("<p><strong>Hi</strong> <em>there</em></p>")).toBe(
      "<p><strong>Hi</strong> <em>there</em></p>",
    );
  });

  it("removes scripts, styles, images, and event handlers", () => {
    expect(
      sanitizeHtml(
        '<p onclick="alert(1)">Hi<img src="x" onerror="alert(2)"></p>' +
          "<script>alert(3)</script><style>p{}</style>",
      ),
    ).toBe("<p>Hi</p>");
  });

  it("unwraps unknown tags and keeps their text", () => {
    expect(sanitizeHtml("<custom><p>Hi</p></custom>")).toBe("<p>Hi</p>");
  });

  it("keeps http(s) links and opens them in a new tab", () => {
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it("drops unsafe links but keeps their text", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toBe("<a>x</a>");
  });

  it("drops every attribute except a safe href", () => {
    expect(sanitizeHtml('<p class="x" style="color:red">Hi</p>')).toBe(
      "<p>Hi</p>",
    );
  });
});

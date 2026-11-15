import { describe, expect, it } from "vitest";
import { htmlToPlainText, textToParagraphHtml } from "./description";

describe("textToParagraphHtml", () => {
  it("turns blank lines into paragraphs", () => {
    expect(textToParagraphHtml("First paragraph.\n\nSecond paragraph.")).toBe(
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    );
  });

  it("keeps a single newline as a line break", () => {
    expect(textToParagraphHtml("One line\nnext line")).toBe(
      "<p>One line<br />next line</p>",
    );
  });

  it("collapses extra blank lines and trims", () => {
    expect(textToParagraphHtml("\n\nA\n\n\n\nB\n\n")).toBe("<p>A</p><p>B</p>");
  });

  it("escapes user text", () => {
    expect(textToParagraphHtml("Tom & Jerry <3")).toBe(
      "<p>Tom &amp; Jerry &lt;3</p>",
    );
  });

  it("returns an empty string for empty text", () => {
    expect(textToParagraphHtml("   \n\n ")).toBe("");
  });
});

describe("htmlToPlainText", () => {
  it("turns paragraph blocks back into blank-line-separated text", () => {
    expect(htmlToPlainText("<p>First</p><p>Second</p>")).toBe(
      "First\n\nSecond",
    );
  });

  it("turns <br> into a line break", () => {
    expect(htmlToPlainText("<p>One<br/>Two</p>")).toBe("One\nTwo");
  });

  it("decodes common entities and strips inline tags", () => {
    expect(
      htmlToPlainText("<p><strong>Tom &amp; Jerry</strong>&nbsp;rules</p>"),
    ).toBe("Tom & Jerry rules");
  });

  it("drops script and style content", () => {
    expect(
      htmlToPlainText("<p>Hi</p><script>alert(1)</script><style>p{}</style>"),
    ).toBe("Hi");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToPlainText("")).toBe("");
  });
});

import { DOMParser } from "@xmldom/xmldom";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanEpub } from "./clean";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${XHTML_NS}"><head><title>t</title></head><body>${body}</body></html>`;
}

function prefixedXhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<x:html xmlns:x="${XHTML_NS}"><x:head><x:title>t</x:title></x:head><x:body>${body}</x:body></x:html>`;
}

function ncx(targets: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
${targets.map((src, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>n</text></navLabel><content src="${src}"/></navPoint>`).join("\n")}
</navMap></ncx>`;
}

function epub(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    mimetype: new TextEncoder().encode("application/epub+zip"),
  };
  for (const [name, text] of Object.entries(files)) {
    entries[name] = new TextEncoder().encode(text);
  }
  return zipSync(entries, { level: 0 });
}

function paragraphText(bytes: Uint8Array, name = "chapter.xhtml"): string[] {
  const entries = unzipSync(bytes);
  const doc = new DOMParser().parseFromString(
    new TextDecoder().decode(entries[name]),
    "application/xhtml+xml",
  );
  const body = doc.getElementsByTagNameNS(XHTML_NS, "body")[0];
  return Array.from(body.getElementsByTagName("p")).map((p) =>
    (p.textContent ?? "").replace(/\s+/gu, " ").trim(),
  );
}

function oneChapter(body: string, extra: Record<string, string> = {}) {
  return epub({ "chapter.xhtml": xhtml(body), ...extra });
}

describe("cleanEpub joins", () => {
  it("joins a sentence split across two paragraphs", () => {
    const result = cleanEpub(
      oneChapter("<p>He walked into</p><p>the room.</p>"),
    );
    expect(result.report.joins).toHaveLength(1);
    expect(paragraphText(result.output!)).toEqual(["He walked into the room."]);
  });

  it("joins three fragments in one pass to one paragraph", () => {
    const result = cleanEpub(
      oneChapter("<p>He walked</p><p>into the</p><p>room.</p>"),
    );
    expect(result.report.joins).toHaveLength(2);
    expect(paragraphText(result.output!)).toEqual(["He walked into the room."]);
  });

  it("is idempotent: a second run joins nothing", () => {
    const first = cleanEpub(
      oneChapter("<p>He walked</p><p>into the room.</p>"),
    );
    expect(first.output).not.toBeNull();
    const second = cleanEpub(first.output!);
    expect(second.report.joins).toHaveLength(0);
    expect(second.output).toBeNull();
  });

  it("writes nothing when there is nothing to join", () => {
    const result = cleanEpub(oneChapter("<p>He walked into the room.</p>"));
    expect(result.output).toBeNull();
    expect(result.report.changedFiles).toEqual([]);
  });
});

describe("cleanEpub guards", () => {
  const cases: Array<[string, string]> = [
    [
      "previous paragraph ends a sentence",
      "<p>He walked into.</p><p>the room.</p>",
    ],
    [
      "previous paragraph ends an em dash",
      "<p>He walked into\u2014</p><p>the room.</p>",
    ],
    [
      "next paragraph starts uppercase",
      "<p>He walked into</p><p>The room.</p>",
    ],
    [
      "an empty paragraph sits between",
      "<p>He walked into</p><p> </p><p>the room.</p>",
    ],
    [
      "the next paragraph holds an image",
      '<p>He walked into</p><p><img src="x.jpg"/>the room.</p>',
    ],
    [
      "the previous paragraph holds an image",
      '<p><img src="x.jpg"/>He walked into</p><p>the room.</p>',
    ],
    [
      "next starts with a URL",
      "<p>Or visit us online at</p><p>us.macmillan.com/newslettersignup</p>",
    ],
    [
      "next starts with a domain",
      "<p>120 Broadway, New York, NY 10271</p><p>fiercereads.com</p>",
    ],
    ["next starts with an email", "<p>Write to</p><p>sales@example.com</p>"],
    [
      "next starts camel-cased",
      "<p>First hardcover edition,</p><p>eBook edition, 2021</p>",
    ],
    [
      "previous ends in a digit",
      "<p>Published in 2021</p><p>by the author.</p>",
    ],
  ];

  for (const [name, body] of cases) {
    it(`does not join when ${name}`, () => {
      const result = cleanEpub(oneChapter(body));
      expect(result.report.joins).toHaveLength(0);
      expect(result.output).toBeNull();
    });
  }

  it("still joins a normal word that ends with a period", () => {
    // "use." must not be mistaken for a domain just because it ends with a dot.
    const result = cleanEpub(
      oneChapter("<p>or business</p><p>use. Please contact us</p>"),
    );
    expect(result.report.joins).toHaveLength(1);
    expect(paragraphText(result.output!)).toEqual([
      "or business use. Please contact us",
    ]);
  });

  it("does not join a heading to a paragraph", () => {
    const result = cleanEpub(
      oneChapter("<h2>Chapter</h2><p>he walked into the room.</p>"),
    );
    expect(result.report.joins).toHaveLength(0);
  });
});

describe("cleanEpub anchors", () => {
  it("keeps the absorbed paragraph's id as an empty span", () => {
    const tocncx = ncx(["chapter.xhtml#page_5"]);
    const result = cleanEpub(
      oneChapter('<p>He walked into</p><p id="page_5">the room.</p>', {
        "toc.ncx": tocncx,
      }),
    );

    expect(result.report.joins).toHaveLength(1);
    expect(result.report.tocProblemsBefore).toEqual([]);
    expect(result.report.tocProblemsAfter).toEqual([]);
    expect(result.report.blocked).toBe(false);

    const output = new TextDecoder().decode(
      unzipSync(result.output!)["chapter.xhtml"],
    );
    expect(output).toContain('id="page_5"');
    expect(output).toContain(`<span id="page_5"`);
    expect(paragraphText(result.output!)).toEqual(["He walked into the room."]);
  });

  it("checks nav.xhtml targets as well", () => {
    const nav = xhtml('<nav><a href="chapter.xhtml#page_5">one</a></nav>');
    const result = cleanEpub(
      oneChapter('<p>He walked into</p><p id="page_5">the room.</p>', {
        "nav.xhtml": nav,
      }),
    );
    expect(result.report.tocProblemsBefore).toEqual([]);
    expect(result.report.tocProblemsAfter).toEqual([]);
  });

  it("reports an already broken target without blocking the write", () => {
    const tocncx = ncx(["chapter.xhtml#page_5", "missing.xhtml#nope"]);
    const result = cleanEpub(
      oneChapter('<p>He walked into</p><p id="page_5">the room.</p>', {
        "toc.ncx": tocncx,
      }),
    );
    expect(result.report.tocProblemsBefore).toHaveLength(1);
    expect(result.report.tocProblemsAfter).toHaveLength(1);
    expect(result.report.blocked).toBe(false);
    expect(result.output).not.toBeNull();
  });
});

describe("cleanEpub output", () => {
  it("keeps the mimetype first and uncompressed", () => {
    const result = cleanEpub(
      oneChapter("<p>He walked into</p><p>the room.</p>"),
    );
    const bytes = result.output!;
    // Local file header: signature at 0, name length at 26, name at 30.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    const nameLength = bytes[26] | (bytes[27] << 8);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
    expect(name).toBe("mimetype");
    const method = bytes[8] | (bytes[9] << 8);
    expect(method).toBe(0);
  });

  it("moves the mimetype entry to the front when the input had it later", () => {
    const entries: Record<string, Uint8Array> = {
      "chapter.xhtml": new TextEncoder().encode(
        xhtml("<p>He walked into</p><p>the room.</p>"),
      ),
      mimetype: new TextEncoder().encode("application/epub+zip"),
    };
    const result = cleanEpub(zipSync(entries, { level: 0 }));
    const bytes = result.output!;
    const nameLength = bytes[26] | (bytes[27] << 8);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
    expect(name).toBe("mimetype");
    const method = bytes[8] | (bytes[9] << 8);
    expect(method).toBe(0);
  });

  it("reports a broken XHTML file instead of throwing", () => {
    const result = cleanEpub(
      epub({
        "chapter.xhtml": `<?xml version="1.0"?><html xmlns="${XHTML_NS}"><body><p>broken`,
      }),
    );
    expect(result.output).toBeNull();
    expect(result.report.error).toContain("cannot clean chapter.xhtml");
  });

  it("accepts a prefixed XHTML namespace", () => {
    const result = cleanEpub(
      epub({
        "chapter.xhtml": prefixedXhtml(
          "<x:p>He walked into</x:p><x:p>the room.</x:p>",
        ),
      }),
    );
    expect(result.report.error).toBeUndefined();
    expect(result.report.joins).toHaveLength(1);
    expect(result.output).not.toBeNull();
    const output = new TextDecoder().decode(
      unzipSync(result.output!)["chapter.xhtml"],
    );
    expect(output).toContain("xmlns:x=");
    expect(output).toContain("He walked into the room.");
  });

  it("keeps the XHTML namespace", () => {
    const result = cleanEpub(
      oneChapter("<p>He walked into</p><p>the room.</p>"),
    );
    const output = new TextDecoder().decode(
      unzipSync(result.output!)["chapter.xhtml"],
    );
    expect(output).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(output.startsWith("<?xml")).toBe(true);
  });

  it("leaves files without a body alone", () => {
    const result = cleanEpub(
      epub({
        "chapter.xhtml": xhtml("<p>He walked into</p><p>the room.</p>"),
        "style.css": "p { color: red }",
      }),
    );
    expect(result.report.changedFiles).toEqual(["chapter.xhtml"]);
  });
});

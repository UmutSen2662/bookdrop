import { describe, expect, it } from "vitest";
import type { Host } from "@/pipeline/host";
import { uniqueLibraryTarget } from "@/pipeline/ingest";
import {
  DEFAULT_FILE_NAME_TEMPLATE,
  formatLibraryFileName,
  templateProblems,
  truncateUtf8,
  withCollisionSuffix,
} from "@/pipeline/names";

function hostWith(names: string[]): Host {
  return {
    listDir: async () => names,
  } as unknown as Host;
}

/** The default shape, for the sanitization tests. */
function libraryFileName(title: string, authors: string): string {
  return formatLibraryFileName(DEFAULT_FILE_NAME_TEMPLATE, { title, authors });
}

describe("libraryFileName", () => {
  it("joins authors with calibre's separator and turns a colon into a dash", () => {
    expect(
      libraryFileName("Title: Subtitle", "First Author & Second Author"),
    ).toBe("First Author & Second Author - Title - Subtitle.epub");
  });

  it("removes characters Windows forbids and control characters", () => {
    expect(libraryFileName('A <bad> "name"?*', "Author")).toBe(
      "Author - A bad name.epub",
    );
  });

  it("avoids a reserved device name", () => {
    expect(libraryFileName("CON", "")).toBe("CON_.epub");
    expect(libraryFileName("COM1.txt", "")).toBe("COM1_.txt.epub");
  });

  it("truncates to 150 UTF-8 bytes including the suffix", () => {
    const name = libraryFileName("é".repeat(200), "");
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".epub")).toBe(true);
  });
});

describe("truncateUtf8", () => {
  it("never splits a multi-byte character", () => {
    expect(truncateUtf8("aé", 2)).toBe("a");
    expect(truncateUtf8("aé", 3)).toBe("aé");
  });
});

describe("withCollisionSuffix", () => {
  it("keeps the suffix when the stem is already at the length limit", () => {
    const stem = formatLibraryFileName("{title}", {
      title: "é".repeat(80),
      authors: "",
    });

    const first = withCollisionSuffix(stem, "abcd1234");
    const second = withCollisionSuffix(stem, "abcd1234", 2);

    expect(first).not.toBe(stem);
    expect(first).not.toBe(second);
    expect(first).toContain("[abcd]");
    expect(second).toContain("[abcd-2]");
    for (const name of [first, second]) {
      expect(name.endsWith(".epub")).toBe(true);
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(150);
    }
  });
});

describe("formatLibraryFileName", () => {
  const book = {
    title: "The Book",
    authors: "Jane Doe",
    series: "The Series",
    seriesIndex: "2",
    published: "2019-04-01",
  };

  it("fills every token", () => {
    expect(
      formatLibraryFileName(
        "{series} {series_index} - {title} ({year}) - {author}",
        book,
      ),
    ).toBe("The Series 2 - The Book (2019) - Jane Doe.epub");
  });

  it("drops a missing token and the separators it leaves behind", () => {
    expect(
      formatLibraryFileName("{series} {series_index} - {title}", {
        title: "The Book",
        authors: "Jane Doe",
      }),
    ).toBe("The Book.epub");
    expect(
      formatLibraryFileName("{author} - {title}", {
        title: "The Book",
        authors: "",
      }),
    ).toBe("The Book.epub");
    expect(
      formatLibraryFileName("{author} - {title} ({series})", {
        title: "The Book",
        authors: "Jane Doe",
      }),
    ).toBe("Jane Doe - The Book.epub");
  });

  it("keeps a number sign that has a value next to it", () => {
    expect(
      formatLibraryFileName("{series} #{series_index} - {title}", book),
    ).toBe("The Series #2 - The Book.epub");
  });

  it("falls back to the title when the template resolves to nothing", () => {
    expect(
      formatLibraryFileName("{series} {series_index}", {
        title: "The Book",
        authors: "Jane Doe",
      }),
    ).toBe("The Book.epub");
  });

  it("uses the default template when the setting is blank", () => {
    expect(formatLibraryFileName("  ", book)).toBe(
      formatLibraryFileName(DEFAULT_FILE_NAME_TEMPLATE, book),
    );
    expect(formatLibraryFileName("  ", book)).toBe("Jane Doe - The Book.epub");
  });

  it("only reads a four-digit year", () => {
    expect(
      formatLibraryFileName("{title} ({year})", {
        title: "The Book",
        authors: "Jane Doe",
        published: "April 2019",
      }),
    ).toBe("The Book (2019).epub");
  });
});

describe("templateProblems", () => {
  it("accepts the default and rejects unknown tokens", () => {
    expect(templateProblems(DEFAULT_FILE_NAME_TEMPLATE)).toEqual([]);
    expect(templateProblems("{series} - {title}")).toEqual([]);
    expect(templateProblems("{narrator} - {title}")).toEqual([
      "Unknown token {narrator}.",
    ]);
  });

  it("rejects an empty template and one with nothing to tell books apart", () => {
    expect(templateProblems("   ")).toEqual(["The template is empty."]);
    expect(templateProblems("{year}")).toEqual([
      "Use {author}, {title}, or {series} so names stay distinct.",
    ]);
  });
});

describe("uniqueLibraryTarget", () => {
  it("keeps a free name", async () => {
    const target = await uniqueLibraryTarget(
      hostWith(["Other.epub"]),
      "/library",
      "Author - Title.epub",
      "abcd1234",
    );
    expect(target).toBe("/library/Author - Title.epub");
  });

  it("adds the hash suffix on a case-only collision", async () => {
    const target = await uniqueLibraryTarget(
      hostWith(["author - title.EPUB"]),
      "/library",
      "Author - Title.epub",
      "abcd1234",
    );
    expect(target).toBe("/library/Author - Title [abcd].epub");
  });

  it("finds a second free name when the first suffix is taken too", async () => {
    const target = await uniqueLibraryTarget(
      hostWith(["Author - Title.epub", "author - title [abcd].epub"]),
      "/library",
      "Author - Title.epub",
      "abcd1234",
    );
    expect(target).toBe("/library/Author - Title [abcd-2].epub");
  });
});

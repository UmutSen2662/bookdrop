import { describe, expect, it } from "vitest";
import { writeMetadata } from "./calibre";
import type { Host } from "./host";
import type { Metadata } from "./types";

const install = { dir: "C:\\Calibre", version: "9.18" };

/** Capture the argv that `ebook-meta` would receive, without running it. */
async function argsFor(metadata: Metadata): Promise<string[]> {
  let captured: string[] = [];
  const host = {
    async runProcess(_program: string, args: string[]) {
      captured = args;
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    },
  } as unknown as Host;

  const result = await writeMetadata(host, install, "book.epub", metadata);
  expect(result.code).toBe(0);
  return captured;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("writeMetadata", () => {
  it("uses --series and --index, never --series-index", async () => {
    const args = await argsFor({
      title: "Book",
      authors: "Author",
      series: "The Series",
      seriesIndex: "2.5",
    });

    expect(valueAfter(args, "--series")).toBe("The Series");
    expect(valueAfter(args, "--index")).toBe("2.5");
    expect(args).not.toContain("--series-index");
  });

  it("sends empty values so an edit can clear optional fields", async () => {
    const args = await argsFor({ title: "Book", authors: "Author" });

    expect(valueAfter(args, "--comments")).toBe("");
    expect(valueAfter(args, "--publisher")).toBe("");
    expect(valueAfter(args, "--isbn")).toBe("");
    expect(valueAfter(args, "--tags")).toBe("");
    expect(valueAfter(args, "--series")).toBe("");
  });

  it("omits language and date when empty, because calibre cannot clear them", async () => {
    const args = await argsFor({
      title: "Book",
      authors: "Author",
      language: "",
      published: "",
    });

    expect(args).not.toContain("--language");
    expect(args).not.toContain("--date");
  });

  it("never sends an empty series index", async () => {
    const args = await argsFor({
      title: "Book",
      authors: "Author",
      series: "The Series",
    });

    expect(valueAfter(args, "--series")).toBe("The Series");
    expect(args).not.toContain("--index");
  });

  it("writes a date at UTC midnight and keeps the language", async () => {
    const args = await argsFor({
      title: "Book",
      authors: "Author",
      published: "2024-05-01",
      language: "eng",
    });

    expect(valueAfter(args, "--date")).toBe("2024-05-01T00:00:00+00:00");
    expect(valueAfter(args, "--language")).toBe("eng");
  });

  it("completes a year or year-month before writing the date", async () => {
    const year = await argsFor({
      title: "Book",
      authors: "Author",
      published: "2024",
    });
    expect(valueAfter(year, "--date")).toBe("2024-01-01T00:00:00+00:00");

    const month = await argsFor({
      title: "Book",
      authors: "Author",
      published: "2024-05",
    });
    expect(valueAfter(month, "--date")).toBe("2024-05-01T00:00:00+00:00");
  });

  it("keeps a timestamp that already carries a time", async () => {
    const args = await argsFor({
      title: "Book",
      authors: "Author",
      published: "2024-05-01T12:30:00+00:00",
    });
    expect(valueAfter(args, "--date")).toBe("2024-05-01T12:30:00+00:00");
  });
});

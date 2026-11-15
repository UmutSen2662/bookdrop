import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  looksDerivedFromFilename,
  mergeMetadata,
  normalizeDate,
  parseOpf,
  stripFilenameJunk,
} from "./metadata";

describe("looksDerivedFromFilename", () => {
  it("treats an exact filename stem as derived", () => {
    expect(looksDerivedFromFilename("Some Book", "/drop/Some Book.txt")).toBe(
      true,
    );
  });

  it("does not mistake a real title for the filename", () => {
    // The dropped name carries the author and site junk; the EPUB's title does
    // not, and must survive a metadata fetch that is turned off.
    expect(
      looksDerivedFromFilename(
        "Imogen, Obviously",
        "/drop/Imogen, Obviously (Becky Albertalli) (z-library.sk, 1lib.sk).epub",
      ),
    ).toBe(false);
  });

  it("ignores the known filename junk when comparing", () => {
    expect(
      looksDerivedFromFilename(
        "Some Book - Anna's Archive",
        "/drop/Some Book - Anna's Archive.pdf",
      ),
    ).toBe(true);
    expect(
      looksDerivedFromFilename("Some Book", "/drop/Some Book (PDFDrive).pdf"),
    ).toBe(true);
  });
});

describe("stripFilenameJunk", () => {
  it("removes the common site tags and keeps the rest", () => {
    expect(
      stripFilenameJunk(
        "Imogen, Obviously (Becky Albertalli) (z-library.sk, 1lib.sk, z-lib.sk)",
      ),
    ).toBe("Imogen, Obviously (Becky Albertalli)");
    expect(stripFilenameJunk("Title - Anna's Archive")).toBe("Title");
    expect(stripFilenameJunk("Title ( PDFDrive )")).toBe("Title");
  });
});

describe("mergeMetadata", () => {
  it("keeps a real title when metadata fetching is off", () => {
    const merged = mergeMetadata(
      { title: "Imogen, Obviously", authors: "Becky Albertalli" },
      [],
      "/drop/Imogen, Obviously (Becky Albertalli) (z-library.sk, 1lib.sk).epub",
    );
    expect(merged.metadata.title).toBe("Imogen, Obviously");
    expect(merged.status).toBe("ok");
    expect(merged.reason).toBeUndefined();
  });

  it("replaces a filename-derived title with the provider title", () => {
    const merged = mergeMetadata(
      { title: "Some Book", authors: "" },
      [
        {
          source: "google_openlibrary",
          values: { title: "The Real Title", authors: "Real Author" },
          match: { title: "The Real Title", authors: "Real Author" },
        },
      ],
      "/drop/Some Book.txt",
    );
    expect(merged.metadata.title).toBe("The Real Title");
    expect(merged.status).toBe("needs_review");
  });

  it("uses the first provider with a value when the file has none", () => {
    const merged = mergeMetadata(
      { title: "Book", authors: "Author" },
      [
        { source: "google_openlibrary", values: {} },
        { source: "itunes", values: { publisher: "iTunes Press" } },
        { source: "open_library", values: { publisher: "Open Library Press" } },
      ],
      "/drop/book.epub",
    );
    expect(merged.metadata.publisher).toBe("iTunes Press");
  });

  it("records an edition mismatch without flagging the book", () => {
    const merged = mergeMetadata(
      { title: "Book", authors: "Author", isbn: "9780000000001" },
      [
        {
          source: "google_openlibrary",
          values: {
            title: "Book",
            authors: "Author",
            isbn: "9780000000002",
          },
          match: { title: "Book", authors: "Author" },
        },
      ],
      "/drop/book.epub",
    );
    expect(merged.status).toBe("ok");
    expect(merged.notes).toContain("edition_mismatch");
  });

  it("keeps a series from the file and fills only an empty index", () => {
    const merged = mergeMetadata(
      { title: "Book", authors: "Author", series: "The Series" },
      [
        {
          source: "google_openlibrary",
          values: { series: "The Series", seriesIndex: "2" },
        },
      ],
      "/drop/book.epub",
    );
    expect(merged.metadata.series).toBe("The Series");
    expect(merged.metadata.seriesIndex).toBe("2");
  });

  it("drops a series index when there is no series name", () => {
    const merged = mergeMetadata(
      { title: "Book", authors: "Author", seriesIndex: "3" },
      [],
      "/drop/book.epub",
    );
    expect(merged.metadata.series).toBeUndefined();
    expect(merged.metadata.seriesIndex).toBeUndefined();
  });

  it("does not attach a provider index to a different file series", () => {
    const merged = mergeMetadata(
      { title: "Book", authors: "Author", series: "File Series" },
      [
        {
          source: "google_openlibrary",
          values: { series: "Provider Series", seriesIndex: "4" },
        },
      ],
      "/drop/book.epub",
    );
    expect(merged.metadata.series).toBe("File Series");
    expect(merged.metadata.seriesIndex).toBeUndefined();
  });
});

describe("parseOpf", () => {
  it("reads calibre's title sort and the author file-as", () => {
    const metadata = parseOpf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>The Long Title</dc:title>
    <dc:creator opf:file-as="Author, First">First Author</dc:creator>
    <meta name="calibre:title_sort" content="Long Title, The"/>
    <dc:identifier opf:scheme="ISBN">978-1-234-56789-7</dc:identifier>
  </metadata>
</package>`);

    expect(metadata.title).toBe("The Long Title");
    expect(metadata.authors).toBe("First Author");
    expect(metadata.authorSort).toBe("Author, First");
    expect(metadata.titleSort).toBe("Long Title, The");
    expect(metadata.isbn).toBe("9781234567897");
  });

  it("reads calibre's series and series index", () => {
    const metadata = parseOpf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Book Two</dc:title>
    <dc:creator>An Author</dc:creator>
    <meta name="calibre:series" content="The Series"/>
    <meta name="calibre:series_index" content="2.0"/>
  </metadata>
</package>`);

    expect(metadata.series).toBe("The Series");
    expect(metadata.seriesIndex).toBe("2.0");
  });
});

describe("normalizeDate", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  it("keeps a plausible date as YYYY-MM-DD", () => {
    expect(normalizeDate("2022-10-13T00:00:00+00:00", now)).toBe("2022-10-13");
  });

  it("drops implausibly old and far-future years", () => {
    expect(normalizeDate("0101-01-01", now)).toBeUndefined();
    expect(normalizeDate("9999-01-01", now)).toBeUndefined();
  });

  it("drops a date that is not on the calendar", () => {
    expect(normalizeDate("2020-02-30", now)).toBeUndefined();
    expect(normalizeDate("2020-13-01", now)).toBeUndefined();
  });
});

describe("buildCandidates", () => {
  it("keeps the file first, labels sources, and drops duplicates", () => {
    const candidates = buildCandidates(
      { title: "Book", authors: "Kelly Quindlen" },
      [
        {
          source: "google_openlibrary",
          values: { title: "Book: A Novel", authors: "Kelly Quindlen" },
        },
      ],
    );

    expect(candidates.fields.title).toEqual([
      { value: "Book", source: "file" },
      { value: "Book: A Novel", source: "google_openlibrary" },
    ]);
    expect(candidates.fields.authors).toEqual([
      { value: "Kelly Quindlen", source: "file" },
    ]);
  });

  it("adds each provider's values under its own id", () => {
    const candidates = buildCandidates(
      { title: "Book", authors: "Kelly Quindlen" },
      [
        {
          source: "itunes",
          values: { title: "Book", authors: "Kelly Quindlen" },
        },
        {
          source: "open_library",
          values: { title: "Book: A Novel", authors: "Kelly Quindlen" },
        },
      ],
    );

    expect(candidates.fields.title).toEqual([
      { value: "Book", source: "file" },
      { value: "Book: A Novel", source: "open_library" },
    ]);
  });
});

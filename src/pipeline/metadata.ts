/**
 * OPF parsing and the merge rule.
 *
 * The file's own metadata wins; the providers only fill gaps or replace a
 * title that was really the filename. Descriptions are HTML and are unescaped
 * once after parsing: calibre double-escapes them in `--to-opf` output.
 */
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { basename, stripExtension } from "@/pipeline/paths";
import {
  CANDIDATE_FIELDS,
  type CandidateField,
  type CandidateSource,
  type Candidates,
  emptyCandidates,
  type Metadata,
  type Status,
} from "@/pipeline/types";

const DC_NS = "http://purl.org/dc/elements/1.1/";
const OPF_NS = "http://www.idpf.org/2007/opf";

export type OpfMetadata = Metadata & {
  /** `urn:uuid:...` or a bare uuid. */
  bookUuid?: string;
  /** Every identifier, for debugging and for the ISBN mismatch note. */
  identifiers?: string[];
};

export type MergeOutcome = {
  metadata: Metadata;
  status: Status;
  reason?: "metadata_missing";
  notes?: string;
};

/**
 * One provider's contribution, in registry priority order. `match` is only set
 * by a source that found a real book; it drives the needs_review decision.
 */
export type ProviderValues = {
  source: CandidateSource;
  values: Partial<Metadata>;
  match?: { title?: string; authors?: string };
};

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

function textOf(element: XmlElement | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/** Decode the entity layer calibre adds on top of the XML escaping. */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&");
}

/** `calibre:title_sort` and friends, stored as OPF `<meta>` elements. */
function metaContent(
  doc: ReturnType<DOMParser["parseFromString"]>,
  name: string,
): string {
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    if ((element.localName ?? element.nodeName).toLowerCase() !== "meta")
      continue;
    if (
      element.getAttribute("name") === name ||
      element.getAttribute("property") === name
    ) {
      const content =
        element.getAttribute("content")?.trim() ||
        (element.textContent ?? "").trim();
      if (content) return content;
    }
  }
  return "";
}

export function parseOpf(xml: string): OpfMetadata {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const first = (name: string) =>
    doc.getElementsByTagNameNS(DC_NS, name)[0] ?? undefined;
  const all = (name: string) =>
    Array.from(doc.getElementsByTagNameNS(DC_NS, name));

  const creators = all("creator")
    .map((element) => textOf(element))
    // calibre writes "Unknown" as a placeholder author when there is none.
    .filter((value) => value && !/^unknown$/iu.test(value));

  const authorSortElement = all("creator")[0];
  let authorSort =
    authorSortElement?.getAttributeNS(OPF_NS, "file-as") ??
    authorSortElement?.getAttribute("opf:file-as") ??
    undefined;
  // calibre stamps file-as="Unknown"; that is worse than no value.
  if (!authorSort || /^unknown$/i.test(authorSort)) authorSort = undefined;

  const identifiers = all("identifier").map((element) => ({
    scheme:
      element.getAttributeNS(OPF_NS, "scheme") ??
      element.getAttribute("opf:scheme") ??
      "",
    value: textOf(element),
  }));

  const isbnEntry = identifiers.find(
    (entry) => /isbn/i.test(entry.scheme) || isIsbn(entry.value),
  );
  const uuidEntry = identifiers.find(
    (entry) =>
      /uuid/i.test(entry.scheme) ||
      /^urn:uuid:/i.test(entry.value) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry.value,
      ),
  );

  const description = first("description");
  const subjects = all("subject")
    .map((element) => textOf(element))
    .filter(Boolean);

  return {
    title: textOf(first("title")),
    authors: creators.join(" & "),
    authorSort,
    titleSort: metaContent(doc, "calibre:title_sort") || undefined,
    isbn: isbnEntry ? normalizeIsbn(isbnEntry.value) : undefined,
    description: description ? unescapeHtml(textOf(description)) : undefined,
    publisher: textOf(first("publisher")) || undefined,
    published: normalizeDate(textOf(first("date"))),
    language: textOf(first("language")) || undefined,
    tags: subjects.length > 0 ? subjects.join(", ") : undefined,
    series: metaContent(doc, "calibre:series") || undefined,
    seriesIndex: metaContent(doc, "calibre:series_index") || undefined,
    bookUuid: uuidEntry?.value.replace(/^urn:uuid:/i, "").toLowerCase(),
    identifiers: identifiers.map((entry) => entry.value).filter(Boolean),
  };
}

function isIsbn(value: string): boolean {
  const digits = value.replace(/[^0-9Xx]/gu, "");
  return /^(?:\d{9}[\dX]|\d{13})$/u.test(digits);
}

export function normalizeIsbn(value: string): string | undefined {
  const digits = value.replace(/[^0-9Xx]/gu, "").toUpperCase();
  return /^(?:\d{9}[\dX]|\d{13})$/u.test(digits) ? digits : undefined;
}

export function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function plausibleYear(year: number, now: Date): boolean {
  return year >= 1000 && year <= now.getFullYear() + 2;
}

/** `YYYY-MM-DD`, or undefined when the value is missing or implausible. */
export function normalizeDate(
  value: string,
  now = new Date(),
): string | undefined {
  if (!value) return undefined;
  const match = /(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!plausibleYear(year, now) || !isRealDate(year, month, day)) {
      return undefined;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const year = Number(/(\d{4})/u.exec(value)?.[1] ?? 0);
  if (!plausibleYear(year, now)) return undefined;
  return `${year}-01-01`;
}

// ---------------------------------------------------------------------------
// normalization
// ---------------------------------------------------------------------------

const FILENAME_JUNK = [
  /\s*\((?:z-library|z-lib|1lib)[^)]*\)/giu,
  /\s*[-–—]\s*Anna'?s Archive\s*/giu,
  /\s*\(\s*PDFDrive\s*\)/giu,
  /\s*\([^)]*annas-archive[^)]*\)/giu,
];

export function stripFilenameJunk(text: string): string {
  let cleaned = text;
  for (const pattern of FILENAME_JUNK) cleaned = cleaned.replace(pattern, " ");
  return cleaned.replace(/\s+/gu, " ").trim();
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[:–—]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function withoutTrailingParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}

function withoutSubtitle(text: string): string {
  const colon = text.search(/[:–—]/u);
  return colon > 0 ? text.slice(0, colon).trim() : text;
}

/** Every normalized shape of a title we are willing to compare. */
export function titleVariants(title: string): string[] {
  const variants = new Set<string>();
  for (const base of [title, withoutSubtitle(title)]) {
    for (const value of [base, withoutTrailingParenthetical(base)]) {
      const normalized = normalizeText(stripFilenameJunk(value));
      if (normalized) variants.add(normalized);
    }
  }
  return [...variants];
}

export function surnameOf(authors: string): string {
  const first = authors.split("&")[0]?.trim() ?? "";
  const parts = first.split(/\s+/u).filter(Boolean);
  return normalizeText(parts[parts.length - 1] ?? "");
}

export function titlesMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = titleVariants(left);
  const b = titleVariants(right);
  return a.some((value) => b.includes(value));
}

/** True when both sides have a surname and they are the same; an unknown side
 * cannot contradict the other. */
export function surnamesMatch(left: string, right: string): boolean {
  const a = surnameOf(left);
  const b = surnameOf(right);
  if (!a || !b) return true;
  return a === b;
}

/**
 * True when the title is just the dropped file's name with the junk removed.
 * Only an exact match counts: a filename like `Title (Author)` starts with the
 * real title, but that title came from the book, not from the filename.
 */
export function looksDerivedFromFilename(
  title: string,
  sourcePath: string,
): boolean {
  const stem = stripFilenameJunk(stripExtension(basename(sourcePath)));
  const normalizedStem = normalizeText(stem);
  const normalizedTitle = normalizeText(stripFilenameJunk(title));
  if (!normalizedTitle) return false;
  return normalizedStem === normalizedTitle;
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

function pick(
  fileValue: string | undefined,
  providers: readonly ProviderValues[],
  field: keyof Metadata,
): string {
  const fromFile = fileValue?.trim();
  if (fromFile) return fromFile;
  for (const provider of providers) {
    const value = provider.values[field]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * The file's series wins; the index can come from any provider that agrees on
 * the series. An index from a different series is never attached, and an index
 * without a series name is dropped.
 */
function mergeSeries(
  file: OpfMetadata,
  providers: readonly ProviderValues[],
): { series?: string; seriesIndex?: string } {
  const fileSeries = file.series?.trim() ?? "";
  if (fileSeries) {
    const fileIndex = file.seriesIndex?.trim() || undefined;
    if (fileIndex) return { series: fileSeries, seriesIndex: fileIndex };
    for (const provider of providers) {
      const series = provider.values.series?.trim() ?? "";
      if (!series || normalizeText(series) !== normalizeText(fileSeries)) {
        continue;
      }
      const index = provider.values.seriesIndex?.trim();
      if (index) return { series: fileSeries, seriesIndex: index };
    }
    return { series: fileSeries, seriesIndex: undefined };
  }

  for (const provider of providers) {
    const series = provider.values.series?.trim();
    if (!series) continue;
    return {
      series,
      seriesIndex: provider.values.seriesIndex?.trim() || undefined,
    };
  }
  return { series: undefined, seriesIndex: undefined };
}

export function mergeMetadata(
  file: OpfMetadata,
  providers: readonly ProviderValues[],
  sourcePath: string,
  now = new Date(),
): MergeOutcome {
  const notes: string[] = [];

  const title = pick(
    looksDerivedFromFilename(file.title, sourcePath) ? undefined : file.title,
    providers,
    "title",
  );
  const authors = pick(file.authors, providers, "authors");
  const isbn = pick(file.isbn, providers, "isbn") || undefined;
  const { series, seriesIndex } = mergeSeries(file, providers);

  const providerIsbn = providers
    .map((provider) => provider.values.isbn?.trim())
    .find(Boolean);
  if (file.isbn && providerIsbn && file.isbn !== providerIsbn) {
    // Common: the print ISBN on the file, the ebook ISBN online. Not a badge.
    notes.push(`edition_mismatch: ${file.isbn} vs ${providerIsbn}`);
  }

  let published = normalizeDate(file.published ?? "", now) ?? undefined;
  if (!published) {
    for (const provider of providers) {
      const value = normalizeDate(provider.values.published ?? "", now);
      if (value) {
        published = value;
        break;
      }
    }
  }

  const metadata: Metadata = {
    title,
    authors,
    authorSort: file.authorSort,
    isbn,
    description: pick(file.description, providers, "description") || undefined,
    publisher: pick(file.publisher, providers, "publisher") || undefined,
    published,
    language: pick(file.language, providers, "language") || undefined,
    tags: pick(file.tags, providers, "tags") || undefined,
    series,
    seriesIndex,
  };

  const matched = providers.find(
    (provider) => provider.match?.title || provider.match?.authors,
  )?.match;

  let status: Status;
  let reason: "metadata_missing" | undefined;

  if (matched) {
    const titleMatches = titlesMatch(file.title, matched.title ?? "");
    const fileSurname = surnameOf(file.authors);
    const providerSurname = surnameOf(matched.authors ?? "");
    // An unknown author on one side cannot contradict the other.
    const authorMatches =
      !fileSurname || !providerSurname || fileSurname === providerSurname;
    status = titleMatches && authorMatches ? "ok" : "needs_review";
  } else if (metadata.title && metadata.authors) {
    status = "ok";
  } else {
    status = "needs_review";
    reason = "metadata_missing";
  }

  return {
    metadata,
    status,
    reason,
    notes: notes.length > 0 ? notes.join("; ") : undefined,
  };
}

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

function candidateValue(
  source: Partial<Metadata> | null,
  field: CandidateField,
  now: Date,
): string | undefined {
  if (!source) return undefined;
  const value = source[field];
  if (value === undefined) return undefined;
  if (field === "published") return normalizeDate(value, now);
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Every value we saw, in priority order: the file first, then each provider in
 * registry order. Identical values are kept once so the picker does not show
 * the same string three times.
 */
export function buildCandidates(
  file: OpfMetadata,
  providers: readonly ProviderValues[],
  now = new Date(),
): Candidates {
  const candidates = emptyCandidates();
  const seen = new Map<CandidateField, Set<string>>();
  for (const field of CANDIDATE_FIELDS) seen.set(field, new Set());

  const add = (
    field: CandidateField,
    value: string | undefined,
    source: CandidateSource,
  ) => {
    if (!value) return;
    const key = value.toLocaleLowerCase("en-US");
    const set = seen.get(field);
    if (!set) return;
    if (set.has(key)) return;
    set.add(key);
    candidates.fields[field].push({ value, source });
  };

  for (const field of CANDIDATE_FIELDS) {
    add(field, candidateValue(file, field, now), "file");
  }
  for (const provider of providers) {
    for (const field of CANDIDATE_FIELDS) {
      add(field, candidateValue(provider.values, field, now), provider.source);
    }
  }

  return candidates;
}

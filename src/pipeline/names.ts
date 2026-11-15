/**
 * Library filenames. Ingest and the explicit "Rename library" action both build
 * names from a flat template; the default reproduces the original
 * `Author - Title.epub` shape.
 */

// biome-ignore-all lint/suspicious/noControlCharactersInRegex: sanitization
// intentionally matches the control characters it removes.

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/iu;
const MAX_BYTES = 150;

export const DEFAULT_FILE_NAME_TEMPLATE = "{author} - {title}";

/** The fixed token set; folder structure is deliberately not supported. */
export const FILE_NAME_TOKENS = [
  "author",
  "title",
  "series",
  "series_index",
  "year",
] as const;

export type FileNameToken = (typeof FILE_NAME_TOKENS)[number];

export type FileNameFields = {
  title: string;
  authors: string;
  series?: string | null;
  seriesIndex?: string | null;
  /** Any date-shaped string; only its four-digit year is used. */
  published?: string | null;
};

const TOKEN_PATTERN = new RegExp(`\\{(${FILE_NAME_TOKENS.join("|")})\\}`, "gu");

/** Stands in for a token whose value is empty until the separators are tidied. */
const EMPTY_TOKEN = "\u0000";

/** Cut a string without splitting a multi-byte character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let used = 0;
  let kept = "";
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;
    used += size;
    kept += character;
  }
  return kept;
}

function sanitize(stem: string): string {
  let value = stem
    // A colon keeps the subtitle readable instead of deleting it.
    .replace(/\s*:\s*/gu, " - ")
    .replace(/[<>:"/\\|?*]/gu, "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");

  value = value.replace(WINDOWS_RESERVED, "$1_");
  return value.normalize("NFC");
}

function tokenValue(token: FileNameToken, fields: FileNameFields): string {
  switch (token) {
    case "author":
      return fields.authors.trim();
    case "title":
      return fields.title.trim();
    case "series":
      return (fields.series ?? "").trim();
    case "series_index":
      return (fields.seriesIndex ?? "").trim();
    case "year":
      return /(\d{4})/u.exec(fields.published ?? "")?.[1] ?? "";
  }
}

const SEPARATOR_CHARS = String.raw`\-–—_:,;|/~`;
const EDGE_CHARS = String.raw`\s\-–—_:,;|/~`;

/**
 * Remove what empty tokens leave behind: `Author -  - Title`, `Title ()`, and
 * separator runs at either end. A substituted value containing a separator run
 * is tidied the same way, which is the price of not tracking value spans.
 */
function tidyStem(stem: string): string {
  return (
    stem
      // A number sign glued to an empty token is a joiner, not content.
      .replace(/#\s*\u0000/gu, " ")
      .replace(/\u0000\s*#/gu, " ")
      .replace(/\u0000/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[([{]\s*[)\]}]/gu, "")
      .replace(
        new RegExp(`([${SEPARATOR_CHARS}])(?:\\s*[${SEPARATOR_CHARS}])+`, "gu"),
        "$1",
      )
      .replace(/\s+/gu, " ")
      .trim()
      .replace(new RegExp(`^[${EDGE_CHARS}]+`, "u"), "")
      .replace(new RegExp(`[${EDGE_CHARS}]+$`, "u"), "")
      .trim()
  );
}

/**
 * `{template}` → a filename. An empty token takes its separators with it, so a
 * standalone book with `{series} {series_index} - {title}` becomes `Title.epub`
 * rather than a name with a dangling dash.
 */
export function formatLibraryFileName(
  template: string,
  fields: FileNameFields,
): string {
  const source = template.trim() || DEFAULT_FILE_NAME_TEMPLATE;
  const substituted = source.replace(TOKEN_PATTERN, (_match, token: string) => {
    const value = tokenValue(token as FileNameToken, fields);
    return value ? value : EMPTY_TOKEN;
  });
  // A template made only of empty tokens still needs a usable name.
  const fallback = fields.title.trim() || fields.authors.trim() || "Untitled";
  const stem = tidyStem(substituted) || tidyStem(fallback);
  const body = truncateUtf8(
    sanitize(stem) || "Untitled",
    MAX_BYTES - ".epub".length,
  ).replace(/[. ]+$/u, "");
  return `${body || "Untitled"}.epub`;
}

/** What Settings should warn about; empty means the template is usable. */
export function templateProblems(template: string): string[] {
  const trimmed = template.trim();
  if (!trimmed) return ["The template is empty."];
  const problems: string[] = [];
  for (const match of trimmed.matchAll(/\{([^}]*)\}/gu)) {
    if (!(FILE_NAME_TOKENS as readonly string[]).includes(match[1])) {
      problems.push(`Unknown token {${match[1]}}.`);
    }
  }
  if (!/\{(?:author|title|series)\}/u.test(trimmed)) {
    problems.push("Use {author}, {title}, or {series} so names stay distinct.");
  }
  return problems;
}

/** `Author - Title [1a2b].epub`: disambiguate a collision, never overwrite. */
export function withCollisionSuffix(
  fileName: string,
  sha256: string,
  attempt = 1,
): string {
  const suffix =
    attempt <= 1
      ? ` [${sha256.slice(0, 4)}]`
      : ` [${sha256.slice(0, 4)}-${attempt}]`;
  const stem = fileName.toLowerCase().endsWith(".epub")
    ? fileName.slice(0, -".epub".length)
    : fileName;
  // Reserve the suffix's bytes first; otherwise a maximum-length stem is
  // truncated back into the same name on every attempt.
  const body = truncateUtf8(
    stem,
    MAX_BYTES - ".epub".length - suffix.length,
  ).replace(/[. ]+$/u, "");
  return `${body}${suffix}.epub`;
}

/**
 * Every calibre call lives here, so executable paths, timeouts, and arguments
 * are in one place. The executables are resolved at runtime: a configured
 * directory wins, then PATH, then the default install location.
 */

import { errorMessage } from "@/pipeline/errors";
import type { Host, ProcessResult } from "@/pipeline/host";
import { dirname, joinPath } from "@/pipeline/paths";
import type { Metadata } from "@/pipeline/types";

export type CalibreInstall = {
  dir: string;
  /** e.g. "9.18.0", for the settings panel and `scripts/check.ts`. */
  version: string;
};

const TOOLS = {
  convert: "ebook-convert",
  meta: "ebook-meta",
  fetch: "fetch-ebook-metadata",
} as const;

export type CalibreTool = keyof typeof TOOLS;

const DEFAULT_DIR = "C:\\Program Files\\Calibre2";
const RESOLVE_TIMEOUT = 20_000;

function versionOf(output: string): string {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(output);
  return match ? match[1] : "unknown";
}

/** Directories to try, in order. An explicit override is never second-guessed. */
async function candidateDirs(
  host: Host,
  overrideDir: string | null | undefined,
): Promise<string[]> {
  if (overrideDir) return [overrideDir];

  const dirs: string[] = [];
  try {
    const where = await host.runProcess("where.exe", ["ebook-convert"], 10_000);
    if (where.code === 0) {
      for (const line of where.stdout.split(/\r?\n/u)) {
        const found = line.trim();
        if (found) dirs.push(dirname(found));
      }
    }
  } catch {
    // `where.exe` missing or unrunnable: fall through to the default.
  }
  dirs.push(DEFAULT_DIR);
  return dirs;
}

/**
 * Find calibre and read its version. Throws with every path tried rather than
 * falling back silently when an override is wrong.
 */
export async function findCalibre(
  host: Host,
  overrideDir?: string | null,
): Promise<CalibreInstall> {
  const tried: string[] = [];
  for (const dir of await candidateDirs(host, overrideDir)) {
    const executable = joinPath(dir, `${TOOLS.convert}.exe`);
    try {
      const result = await host.runProcess(
        executable,
        ["--version"],
        RESOLVE_TIMEOUT,
      );
      if (result.code === 0) {
        return { dir, version: versionOf(result.stdout) };
      }
      tried.push(`${dir} (exit ${result.code})`);
    } catch (error) {
      tried.push(`${dir} (${errorMessage(error)})`);
    }
  }

  throw new Error(
    `calibre not found. Tried: ${tried.join("; ")}. Install calibre, put it on PATH, or set a folder in Settings (calibreDir in config.json for scripts).`,
  );
}

export function calibrePath(
  install: CalibreInstall,
  tool: CalibreTool,
): string {
  return joinPath(install.dir, `${TOOLS[tool]}.exe`);
}

export async function runCalibre(
  host: Host,
  install: CalibreInstall,
  tool: CalibreTool,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return host.runProcess(calibrePath(install, tool), args, timeoutMs);
}

/** The last ~2000 characters of output, for the row's `error` column. */
export function failureText(result: ProcessResult): string {
  const text = (result.stderr.trim() || result.stdout.trim()).replace(
    /\r\n/gu,
    "\n",
  );
  return text.slice(-2000);
}

export const CONVERT_TIMEOUT = 10 * 60_000;
export const METADATA_TIMEOUT = 120_000;
export const FETCH_TIMEOUT = 60_000;

export async function convertToEpub(
  host: Host,
  install: CalibreInstall,
  inputPath: string,
  outputPath: string,
  isPdf: boolean,
): Promise<ProcessResult> {
  const args = [inputPath, outputPath];
  // Only PDF input accepts the pdf engine choice; other formats reject it.
  if (isPdf) args.push("--pdf-engine", "calibre");
  return runCalibre(host, install, "convert", args, CONVERT_TIMEOUT);
}

/** `ebook-meta <epub> --to-opf <file>`; returns the OPF text. */
export async function readMetadataOpf(
  host: Host,
  install: CalibreInstall,
  epubPath: string,
  opfPath: string,
): Promise<string> {
  const result = await runCalibre(
    host,
    install,
    "meta",
    [epubPath, "--to-opf", opfPath],
    METADATA_TIMEOUT,
  );
  if (result.code !== 0) {
    throw new Error(`ebook-meta --to-opf failed: ${failureText(result)}`);
  }
  return new TextDecoder("utf-8").decode(await host.readFile(opfPath));
}

export type FetchQuery = {
  isbn?: string;
  title?: string;
  authors?: string;
};

/**
 * Ask Google and Open Library. The plugin list is pinned: the default set
 * warms up a browser for Amazon and hangs past two minutes.
 * `-o` writes an OPF to stdout, so the human-readable part is stderr.
 *
 * Never pass `-c`: cover download hangs in calibre 9.18. Covers are fetched
 * directly by `covers.ts`.
 */
export async function fetchMetadata(
  host: Host,
  install: CalibreInstall,
  query: FetchQuery,
): Promise<ProcessResult> {
  const args = ["-p", "Google", "-p", "Open Library", "-o", "-d", "15"];
  if (query.isbn) {
    args.push("-i", query.isbn);
  } else {
    if (query.title) args.push("-t", query.title);
    if (query.authors) args.push("-a", query.authors);
  }
  return runCalibre(host, install, "fetch", args, FETCH_TIMEOUT);
}

/**
 * `2020` -> `2020-01-01`, `2020-05` -> `2020-05-01`. Anything else is passed
 * through; the sheet has already validated it.
 */
function completeDate(value: string): string {
  if (/^\d{4}$/u.test(value)) return `${value}-01-01`;
  if (/^\d{4}-\d{2}$/u.test(value)) return `${value}-01`;
  return value;
}

/**
 * Write the merged metadata with explicit long flags. Never `--from-opf`.
 *
 * Optional text fields are sent even when empty so an edit can clear them:
 * calibre treats an explicit empty value as "remove this field". Language and
 * date are the exceptions; calibre ignores an empty language and rejects an
 * empty date, so those keep whatever the file had.
 *
 * The series index flag is `--index`; `--series-index` does not exist on
 * `ebook-meta`, and an empty value would crash `float()`.
 */
export async function writeMetadata(
  host: Host,
  install: CalibreInstall,
  epubPath: string,
  metadata: Metadata,
  coverPath?: string,
): Promise<ProcessResult> {
  const args: string[] = [
    epubPath,
    "--title",
    metadata.title,
    "--authors",
    metadata.authors,
    "--comments",
    metadata.description ?? "",
    "--publisher",
    metadata.publisher ?? "",
    "--isbn",
    metadata.isbn ?? "",
    "--tags",
    metadata.tags ?? "",
    "--series",
    metadata.series ?? "",
  ];
  if (metadata.published) {
    // A bare YYYY-MM-DD is read as local midnight, stored as UTC, and read back
    // a day earlier in positive timezones; every re-ingest would drift. Pin the
    // date to UTC midnight instead. The sheet accepts a year or year-month too,
    // so complete those before handing the value to calibre.
    const date = metadata.published.includes("T")
      ? metadata.published
      : `${completeDate(metadata.published)}T00:00:00+00:00`;
    args.push("--date", date);
  }
  if (metadata.language) args.push("--language", metadata.language);
  if (metadata.series && metadata.seriesIndex) {
    args.push("--index", metadata.seriesIndex);
  }
  if (coverPath) args.push("--cover", coverPath);
  return runCalibre(host, install, "meta", args, METADATA_TIMEOUT);
}

/** `ebook-meta <epub> --get-cover <file>`; false when the book has no cover. */
export async function extractCover(
  host: Host,
  install: CalibreInstall,
  epubPath: string,
  coverPath: string,
): Promise<boolean> {
  const result = await runCalibre(
    host,
    install,
    "meta",
    [epubPath, "--get-cover", coverPath],
    METADATA_TIMEOUT,
  );
  if (result.code !== 0) return false;
  return Boolean((await host.stat(coverPath))?.size);
}

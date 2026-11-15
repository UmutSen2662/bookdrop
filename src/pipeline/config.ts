/**
 * `%LOCALAPPDATA%\bookdrop\config.json`, read with JSON.parse.
 * Environment variables override, so scripts and tests never touch the real
 * settings or the real library folder.
 */

import { errorMessage } from "./errors";
import type { Host } from "./host";
import { DEFAULT_FILE_NAME_TEMPLATE } from "./names";
import { joinPath, toForwardSlashes } from "./paths";

export type Config = {
  /** Directory holding config.json, db.sqlite, covers, tmp. */
  homeDir: string;
  /** Empty until the user picks one; the app shows first-run instead of guessing. */
  libraryDir: string;
  archiveOriginals: boolean;
  originalsDir: string;
  fetchMetadata: boolean;
  cleanConverted: boolean;
  fetchCovers: boolean;
  /** Null means detect calibre; a directory pins it. */
  calibreDir: string | null;
  /** The grid's sort order; UI-only, but persisted with the rest. */
  sortBy: SortBy;
  /** Flat naming template for library files, e.g. `{author} - {title}`. */
  fileNameTemplate: string;
};

export const SORT_OPTIONS = [
  "author",
  "title",
  "added",
  "published",
  "series",
] as const;

export type SortBy = (typeof SORT_OPTIONS)[number];

export function configPath(config: Config): string {
  return joinPath(config.homeDir, "config.json");
}

function env(host: Host, name: string): string | undefined {
  const value = host.env(name);
  return value === undefined || value === "" ? undefined : value;
}

function defaults(host: Host): Config {
  const home =
    env(host, "BOOKDROP_HOME") ??
    joinPath(
      env(host, "LOCALAPPDATA") ?? env(host, "APPDATA") ?? ".",
      "bookdrop",
    );
  const userProfile = env(host, "USERPROFILE") ?? env(host, "HOME") ?? ".";

  return {
    homeDir: home,
    libraryDir: env(host, "BOOKDROP_LIBRARY") ?? "",
    archiveOriginals: env(host, "BOOKDROP_ARCHIVE") === "1",
    originalsDir:
      env(host, "BOOKDROP_ORIGINALS") ??
      joinPath(userProfile, "bookdrop-originals"),
    fetchMetadata: env(host, "BOOKDROP_FETCH") !== "0",
    cleanConverted: env(host, "BOOKDROP_CLEAN") !== "0",
    fetchCovers: env(host, "BOOKDROP_COVERS") !== "0",
    calibreDir: env(host, "BOOKDROP_CALIBRE") ?? null,
    sortBy: "author",
    fileNameTemplate:
      env(host, "BOOKDROP_TEMPLATE") ?? DEFAULT_FILE_NAME_TEMPLATE,
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asSortBy(value: unknown, fallback: SortBy): SortBy {
  return typeof value === "string" &&
    (SORT_OPTIONS as readonly string[]).includes(value)
    ? (value as SortBy)
    : fallback;
}

export async function loadConfig(host: Host): Promise<Config> {
  const config = defaults(host);
  const path = configPath(config);

  if (!(await host.stat(path))) return config;

  let stored: Record<string, unknown>;
  try {
    const text = new TextDecoder("utf-8").decode(await host.readFile(path));
    stored = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`config.json is not valid JSON: ${errorMessage(error)}`);
  }

  return {
    ...config,
    libraryDir: asString(stored.libraryDir, config.libraryDir),
    archiveOriginals: asBoolean(
      stored.archiveOriginals,
      config.archiveOriginals,
    ),
    originalsDir: asString(stored.originalsDir, config.originalsDir),
    fetchMetadata: asBoolean(stored.fetchMetadata, config.fetchMetadata),
    cleanConverted: asBoolean(stored.cleanConverted, config.cleanConverted),
    fetchCovers: asBoolean(stored.fetchCovers, config.fetchCovers),
    calibreDir:
      typeof stored.calibreDir === "string" && stored.calibreDir.trim()
        ? stored.calibreDir.trim()
        : config.calibreDir,
    sortBy: asSortBy(stored.sortBy, config.sortBy),
    fileNameTemplate:
      typeof stored.fileNameTemplate === "string" &&
      stored.fileNameTemplate.trim()
        ? stored.fileNameTemplate.trim()
        : config.fileNameTemplate,
  };
}

/** Write the settings the first-run screen and the Settings modal change. */
export async function saveConfig(host: Host, config: Config): Promise<void> {
  await host.ensureDir(config.homeDir);
  const stored = {
    // Forward slashes keep the file readable and avoid double escaping.
    libraryDir: toForwardSlashes(config.libraryDir),
    archiveOriginals: config.archiveOriginals,
    originalsDir: toForwardSlashes(config.originalsDir),
    fetchMetadata: config.fetchMetadata,
    cleanConverted: config.cleanConverted,
    fetchCovers: config.fetchCovers,
    calibreDir: config.calibreDir ? toForwardSlashes(config.calibreDir) : null,
    sortBy: asSortBy(config.sortBy, "author"),
    fileNameTemplate:
      config.fileNameTemplate.trim() || DEFAULT_FILE_NAME_TEMPLATE,
  };
  const text = `${JSON.stringify(stored, null, 2)}\n`;
  await host.writeFileAtomic(
    configPath(config),
    new TextEncoder().encode(text),
  );
}

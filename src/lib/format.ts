import { sourceLabel } from "@/pipeline/sources/labels";
import type { FlagReason } from "@/pipeline/types";

export { sourceLabel };

export function reasonLabel(reason: FlagReason | null | undefined): string {
  switch (reason) {
    case "drm":
      return "DRM";
    case "no_text":
      return "no text (scanned?)";
    case "convert_failed":
      return "conversion failed";
    case "clean_failed":
      return "cleaning failed";
    case "unreadable":
      return "unreadable file";
    case "metadata_missing":
      return "metadata missing";
    default:
      return "problem";
  }
}

const LEADING_ARTICLES = new Set(["a", "an", "the"]);
const INITIAL_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/**
 * Two initials for the missing-cover placeholder. Leading articles go, and
 * joining words are skipped when looking for the second letter, but the first
 * real word is always kept: "The Time Machine" -> TM, "On the Road" -> OR.
 */
export function initials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return "?";

  const start =
    words.length > 1 &&
    LEADING_ARTICLES.has(words[0].toLocaleLowerCase("en-US"))
      ? 1
      : 0;
  const first = words[start];
  if (!first) return "?";

  let second = "";
  for (let index = start + 1; index < words.length; index++) {
    const word = words[index];
    if (!INITIAL_CONNECTORS.has(word.toLocaleLowerCase("en-US"))) {
      second = word;
      break;
    }
  }

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

/** File sizes for the archive summary. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

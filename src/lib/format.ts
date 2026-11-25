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

/** Two initials for the missing-cover placeholder. */
export function initials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[1].charAt(0) : "";
  return `${first}${second}`.toUpperCase();
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

/**
 * Tags are stored and written as one comma-separated string, because that is
 * what calibre's `--tags` flag accepts. The UI treats them as a set: trim,
 * drop duplicates without regard to case, and sort alphabetically.
 */

/** Split a stored tag string into individual, non-empty tags. */
export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Trim, remove commas (a tag cannot contain one), drop case-insensitive
 * duplicates, and sort. The first spelling of a duplicate wins.
 */
export function canonicalTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/,/gu, " ").replace(/\s+/gu, " ").trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(tag);
  }
  return kept.sort((left, right) =>
    left.localeCompare(right, "en-US", { sensitivity: "base" }),
  );
}

/** The canonical string calibre expects. */
export function serializeTags(tags: string[]): string {
  return canonicalTags(tags).join(", ");
}

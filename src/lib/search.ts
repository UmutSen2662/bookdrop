/**
 * Client-side library search. Every space-separated token must match the title,
 * authors, series, or tags (AND); matching is by word prefix, not raw substring,
 * so "quindl" and "drives cr" both work. `author:`, `title:`, `series:`, and
 * `tag:` narrow a token.
 */
import type { Book } from "../pipeline/types";

export type QueryToken = {
  field: "author" | "title" | "series" | "tag" | null;
  term: string;
};

/** Casefold, strip diacritics and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

export function parseQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  for (const raw of query.trim().split(/\s+/u)) {
    if (!raw) continue;
    const match = /^(author|title|series|tag):(.*)$/iu.exec(raw);
    const field = match
      ? (match[1].toLowerCase() as "author" | "title" | "series" | "tag")
      : null;
    const value = match ? match[2] : raw;
    for (const term of words(value)) tokens.push({ field, term });
  }
  return tokens;
}

function matchesWord(text: string, term: string): boolean {
  return words(text).some((word) => word.startsWith(term));
}

function fieldText(book: Book, field: QueryToken["field"]): string {
  switch (field) {
    case "author":
      return book.authors;
    case "title":
      return book.title;
    case "series":
      return book.series ?? "";
    case "tag":
      return book.tags ?? "";
    default:
      return [
        book.title,
        book.authors,
        book.series ?? "",
        book.tags ?? "",
      ].join(" ");
  }
}

export function bookMatches(book: Book, tokens: QueryToken[]): boolean {
  return tokens.every((token) =>
    matchesWord(fieldText(book, token.field), token.term),
  );
}

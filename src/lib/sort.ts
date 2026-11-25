/**
 * Grid sorting. The pinned zone keeps its own drag order; only the unpinned
 * books reach this function. Missing values always sort last, so a standalone
 * book does not jump to the top of a series sort.
 */
import type { SortBy } from "@/pipeline/config";
import type { Book } from "@/pipeline/types";

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = text(left);
  const b = text(right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

function titleOf(book: Book): string {
  return text(book.titleSort) || text(book.title);
}

function authorOf(book: Book): string {
  return text(book.authorSort) || text(book.authors);
}

function compareTitle(left: Book, right: Book): number {
  return (
    compareText(titleOf(left), titleOf(right)) ||
    compareText(left.authors, right.authors)
  );
}

function compareAuthor(left: Book, right: Book): number {
  return (
    compareText(authorOf(left), authorOf(right)) || compareTitle(left, right)
  );
}

function seriesIndex(book: Book): number | null {
  const value = Number.parseFloat(text(book.seriesIndex));
  return Number.isFinite(value) ? value : null;
}

function compareSeries(left: Book, right: Book): number {
  const byName = compareText(left.series, right.series);
  if (byName !== 0) return byName;

  const a = seriesIndex(left);
  const b = seriesIndex(right);
  if (a === null && b === null) return compareTitle(left, right);
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b || compareTitle(left, right);
}

function compareAdded(left: Book, right: Book): number {
  // Newest first; added_at is ISO, so string order is time order.
  if (left.addedAt === right.addedAt) return compareTitle(left, right);
  return left.addedAt < right.addedAt ? 1 : -1;
}

function comparePublished(left: Book, right: Book): number {
  const a = text(left.published);
  const b = text(right.published);
  if (!a && !b) return compareTitle(left, right);
  if (!a) return 1;
  if (!b) return -1;
  if (a === b) return compareTitle(left, right);
  return a < b ? 1 : -1;
}

export function sortBooks(books: Book[], sortBy: SortBy): Book[] {
  const sorted = [...books];
  switch (sortBy) {
    case "title":
      sorted.sort(compareTitle);
      break;
    case "added":
      sorted.sort(compareAdded);
      break;
    case "published":
      sorted.sort(comparePublished);
      break;
    case "series":
      sorted.sort(compareSeries);
      break;
    default:
      sorted.sort(compareAuthor);
      break;
  }
  return sorted;
}

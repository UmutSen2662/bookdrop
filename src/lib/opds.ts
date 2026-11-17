/**
 * The snapshot the LAN catalog may serve.
 *
 * The database stays the source of truth: the Rust server only sees this list,
 * so it cannot serve a file that is not in it. Everything the reader needs is
 * flattened here once, when the library changes.
 */

import { basename, joinPath, stripExtension } from "../pipeline/paths";
import type { Book } from "../pipeline/types";
import { htmlToPlainText } from "./description";

/** Long blurbs bloat every feed page for no reading benefit on e-ink. */
const MAX_DESCRIPTION = 800;

export type ShareBook = {
  id: number;
  title: string;
  authors: string;
  titleSort: string | null;
  updatedAt: string;
  language: string | null;
  series: string | null;
  description: string | null;
  /** Absolute path of the library EPUB. */
  filePath: string;
  fileName: string;
  fileSize: number | null;
  /** Absolute path of the cached cover thumbnail, when there is one. */
  coverPath: string | null;
};

/**
 * Everything the reader can actually open. Flagged rows have no usable file
 * and missing rows would 404, so both stay out. `needs_review` books are
 * readable — just imperfectly labelled — and are included on purpose.
 */
export function shareEntries(books: Book[], homeDir: string): ShareBook[] {
  return books.flatMap((book) => {
    if (!book.libraryPath || book.missing || book.status === "flagged") {
      return [];
    }

    const fileName = basename(book.libraryPath);
    return [
      {
        id: book.id,
        title: book.title.trim() || stripExtension(fileName).trim() || fileName,
        authors: book.authors.trim() || "Unknown author",
        titleSort: book.titleSort?.trim() || null,
        updatedAt: book.updatedAt,
        language: book.language?.trim() || null,
        series: book.series?.trim() || null,
        description: book.description
          ? plainDescription(book.description)
          : null,
        filePath: book.libraryPath,
        fileName,
        fileSize: book.fileSize,
        coverPath:
          book.hasCover && homeDir
            ? joinPath(homeDir, "covers", `${book.id}.jpg`)
            : null,
      },
    ];
  });
}

function plainDescription(html: string): string | null {
  const text = htmlToPlainText(html).slice(0, MAX_DESCRIPTION).trim();
  return text || null;
}

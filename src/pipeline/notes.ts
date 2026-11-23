/**
 * The notes export: reading status and personal notes, keyed by the EPUB's
 * identifiers so a later import can match books in another library folder.
 * The EPUB itself is not included.
 */
import type { Book } from "./types";

export const NOTES_FORMAT = "bookdrop-notes";
export const NOTES_FORMAT_VERSION = 1;

export type NotesExport = {
  format: typeof NOTES_FORMAT;
  version: typeof NOTES_FORMAT_VERSION;
  exportedAt: string;
  books: {
    bookUuid: string | null;
    sha256: string;
    epubSha256: string | null;
    title: string;
    authors: string;
    readStatus: Book["readStatus"];
    personalNotes: string | null;
  }[];
};

export function notesExportJson(books: Book[], exportedAt: Date): string {
  const data: NotesExport = {
    format: NOTES_FORMAT,
    version: NOTES_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    books: books.map((book) => ({
      bookUuid: book.bookUuid,
      sha256: book.sha256,
      epubSha256: book.epubSha256,
      title: book.title,
      authors: book.authors,
      readStatus: book.readStatus,
      personalNotes: book.personalNotes,
    })),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function notesExportFileName(exportedAt: Date): string {
  return `bookdrop-notes-${exportedAt.toISOString().slice(0, 10)}.json`;
}

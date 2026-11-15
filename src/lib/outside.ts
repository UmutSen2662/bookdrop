/**
 * Books can outlive a library-folder change: their files are fine, just in a
 * folder the app no longer scans. This is derived UI state, not a database
 * flag, so switching the folder back clears it immediately.
 */
import { dirname, normalizedFolder } from "../pipeline/paths";
import type { Book } from "../pipeline/types";

export { normalizedFolder };

/** True when the book's file is outside the configured library folder. */
export function isOutsideLibrary(
  book: Pick<Book, "libraryPath">,
  libraryDir: string,
): boolean {
  if (!book.libraryPath || !libraryDir) return false;
  return (
    normalizedFolder(dirname(book.libraryPath)) !== normalizedFolder(libraryDir)
  );
}

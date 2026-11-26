import { BookOpen, Pencil, Trash2, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SECTION_LABEL } from "@/components/ui/typography";
import { reasonLabel } from "@/lib/format";
import { isOutsideLibrary } from "@/lib/outside";
import { sanitizeHtml } from "@/lib/sanitize";
import { canonicalTags, parseTags } from "@/lib/tags";
import { errorMessage } from "@/pipeline/errors";
import { dirname } from "@/pipeline/paths";
import { type Book, READ_STATUSES, type ReadStatus } from "@/pipeline/types";

type Props = {
  book: Book | null;
  homeDir: string;
  libraryDir: string;
  /** How many books in the library share this title's series, if any. */
  seriesTotal?: number;
  onEdit: (book: Book) => void;
  onRemove: (book: Book) => void;
  onOpenCover: (book: Book) => void;
  onOpen: (book: Book) => void;
  onOpenFolder: (book: Book) => void;
  onRecheck: (book: Book) => void;
  onSaveReading: (
    book: Book,
    reading: { status: ReadStatus; notes: string | null },
  ) => Promise<Book>;
};

const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

/**
 * Notes save on a short debounce, and React cleanup does not run when the
 * Tauri window closes. A synchronous draft keeps the last keystrokes until a
 * save confirms them.
 */
function draftKeyFor(book: Book | null): string | null {
  return book ? `bookdrop-notes-${book.sha256}-${book.id}` : null;
}

function readDraft(key: string | null): string | null {
  if (!key || typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDraft(key: string | null, value: string): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable; the debounced save still runs.
  }
}

function clearDraft(key: string | null): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

export function BookPanel({
  book,
  homeDir,
  libraryDir,
  seriesTotal,
  onEdit,
  onRemove,
  onOpenCover,
  onOpen,
  onOpenFolder,
  onRecheck,
  onSaveReading,
}: Props) {
  const draftKey = draftKeyFor(book);
  const [status, setStatus] = useState<ReadStatus>(
    book?.readStatus ?? "unread",
  );
  const [notes, setNotes] = useState(
    () => readDraft(draftKey) ?? book?.personalNotes ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const savedStatusRef = useRef<ReadStatus>(book?.readStatus ?? "unread");
  const requestedStatusRef = useRef<ReadStatus>(book?.readStatus ?? "unread");
  const savedNotesRef = useRef(book?.personalNotes ?? "");
  const lastQueuedNotesRef = useRef(book?.personalNotes ?? "");
  const notesTimerRef = useRef<number | null>(null);
  const queueRef = useRef(Promise.resolve());
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;

  const bookRef = useRef(book);
  bookRef.current = book;
  const statusRef = useRef(status);
  statusRef.current = status;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const saveNow = useCallback(
    (nextStatus: ReadStatus, nextNotes: string) => {
      if (!bookRef.current) return;
      if (notesTimerRef.current !== null) {
        window.clearTimeout(notesTimerRef.current);
        notesTimerRef.current = null;
      }
      const trimmed = nextNotes.trim();
      if (
        nextStatus === savedStatusRef.current &&
        trimmed === savedNotesRef.current.trim()
      ) {
        return;
      }

      lastQueuedNotesRef.current = nextNotes;
      setError(null);
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const current = bookRef.current;
            if (!current) return;
            const updated = await onSaveReading(current, {
              status: nextStatus,
              notes: trimmed || null,
            });
            savedStatusRef.current = updated.readStatus;
            savedNotesRef.current = updated.personalNotes ?? "";
            // A queued save may be older than the select's latest value.
            if (updated.readStatus === requestedStatusRef.current) {
              setStatus(updated.readStatus);
            }
            setNotes((value) =>
              value === nextNotes ? (updated.personalNotes ?? "") : value,
            );
            if (notesRef.current === nextNotes) {
              clearDraft(draftKeyRef.current);
            }
            setError(null);
          } catch (saveError) {
            setError(errorMessage(saveError));
            if (lastQueuedNotesRef.current === nextNotes) {
              lastQueuedNotesRef.current = savedNotesRef.current;
            }
            if (nextStatus === requestedStatusRef.current) {
              setStatus(savedStatusRef.current);
            }
          }
        });
    },
    [onSaveReading],
  );

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // Notes save by themselves: a short debounce while typing, flushed early by
  // a blur or a status change.
  useEffect(() => {
    if (notes.trim() === savedNotesRef.current.trim()) return;
    const timer = window.setTimeout(() => {
      saveNow(statusRef.current, notesRef.current);
    }, 600);
    notesTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (notesTimerRef.current === timer) notesTimerRef.current = null;
    };
  }, [notes, saveNow]);

  // Switching books or closing the panel must not drop the last edit.
  useEffect(() => {
    return () => {
      if (!bookRef.current) return;
      if (notesRef.current === lastQueuedNotesRef.current) return;
      saveNowRef.current(statusRef.current, notesRef.current);
    };
  }, []);

  if (!book) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <BookOpen className="size-7 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium">Select a book</p>
        <p className="text-xs text-muted-foreground">
          Click a card to see its cover, description, and metadata.
        </p>
      </div>
    );
  }

  const description = sanitizeHtml(book.description);
  const tags = canonicalTags(parseTags(book.tags));
  const series = seriesLabel(book.series, book.seriesIndex, seriesTotal);
  const outside = !book.missing && isOutsideLibrary(book, libraryDir);

  return (
    <ScrollArea className="h-full select-text">
      <div className="p-5">
        <button
          type="button"
          onClick={() => onOpenCover(book)}
          aria-label="View cover full size"
          className="group relative block aspect-[2/3] w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BookCover
            bookId={book.id}
            title={book.title}
            homeDir={homeDir}
            updatedAt={book.updatedAt}
            alt={book.title}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
            <ZoomIn
              className="size-6 text-white opacity-0 transition group-hover:opacity-100"
              aria-hidden
            />
          </span>
        </button>

        <h2 className="mt-4 break-words text-xl font-semibold leading-snug">
          {book.title || "Untitled"}
        </h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {book.authors || "Unknown author"}
        </p>

        {book.missing && (
          <Callout className="mt-3">
            <p className="font-semibold">File missing</p>
            <p
              className="mt-1 break-all text-[11px] text-destructive/80"
              title={book.libraryPath ?? ""}
            >
              {book.libraryPath}
            </p>
            <p className="mt-1 text-[11px] text-destructive/80">
              Put the file back at this path, then Recheck. Opening the folder
              is a good place to start looking.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => onOpenFolder(book)}
              >
                Open folder
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => onRecheck(book)}
              >
                Recheck
              </Button>
            </div>
          </Callout>
        )}

        {outside && (
          <Callout tone="warning" className="mt-3">
            <p className="font-semibold">Outside library folder</p>
            <p
              className="mt-1 break-all text-[11px] text-amber-800/80 dark:text-amber-200/80"
              title={book.libraryPath ?? ""}
            >
              {dirname(book.libraryPath ?? "")}
            </p>
            <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/80">
              This book is still in another folder. Move it into the current
              library folder, or switch back in Settings.
            </p>
            <div className="mt-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => onOpenFolder(book)}
              >
                Open folder
              </Button>
            </div>
          </Callout>
        )}

        {book.status === "needs_review" && (
          <Callout tone="warning" className="mt-4">
            Needs review
            {book.flagReason ? ` · ${reasonLabel(book.flagReason)}` : ""}. Edit
            the fields or remove the book.
          </Callout>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => onOpen(book)}
            disabled={!book.libraryPath || book.missing}
            title={book.missing ? "The library file is missing" : undefined}
          >
            <BookOpen aria-hidden />
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(book)}>
            <Pencil aria-hidden />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(book)}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
          <div className="ml-auto shrink-0">
            <Select
              items={READ_STATUSES.map((value) => ({
                value,
                label: READ_STATUS_LABELS[value],
              }))}
              value={status}
              onValueChange={(value) => {
                if (!value) return;
                const next = value as ReadStatus;
                requestedStatusRef.current = next;
                setStatus(next);
                saveNow(next, notesRef.current);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Reading status"
                title="Reading status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {READ_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {READ_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`book-notes-${book.id}`} className={SECTION_LABEL}>
              Notes
            </label>
            <span className="text-[11px] text-muted-foreground">
              Private; not written to the EPUB.
            </span>
          </div>
          <textarea
            id={`book-notes-${book.id}`}
            value={notes}
            onChange={(event) => {
              const value = event.target.value;
              setNotes(value);
              writeDraft(draftKeyRef.current, value);
            }}
            onBlur={() => {
              if (notesRef.current === lastQueuedNotesRef.current) return;
              saveNow(statusRef.current, notesRef.current);
            }}
            rows={4}
            placeholder="Quotes, thoughts, where you left off…"
            className="mt-2 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {error && (
            <p
              className="mt-1 text-[11px] text-destructive"
              title={error}
              role="alert"
            >
              Could not save reading state.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => saveNow(statusRef.current, notesRef.current)}
              >
                Retry
              </button>
            </p>
          )}
        </div>

        <div className="mt-4">
          <h3 className={SECTION_LABEL}>Description</h3>
          {description ? (
            <div
              className="mt-2 space-y-2 break-words text-sm leading-relaxed [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: description }}
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No description.
            </p>
          )}
        </div>

        {tags.length > 0 && (
          <div className="mt-4">
            <h3 className={SECTION_LABEL}>Tags</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="max-w-full truncate rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]"
                  title={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <dl className="mt-4 space-y-2 text-sm">
          {series && <Detail label="Series" value={series} />}
          <Detail label="ISBN" value={book.isbn} />
          <Detail label="Publisher" value={book.publisher} />
          <Detail label="Published" value={book.published} />
          <Detail label="Language" value={book.language} />
        </dl>

        {(book.error || book.notes) && (
          <details className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">
              Import details
            </summary>
            {book.error && (
              <ScrollArea className="mt-2 max-h-40">
                <p className="whitespace-pre-wrap break-words text-destructive/90">
                  {book.error}
                </p>
              </ScrollArea>
            )}
            {book.notes && (
              <p className="mt-2 whitespace-pre-wrap break-words">
                {book.notes}
              </p>
            )}
          </details>
        )}
      </div>
    </ScrollArea>
  );
}

function seriesLabel(
  series: string | null,
  index: string | null,
  total?: number,
): string | null {
  if (!series) return null;
  if (!index) return series;
  const suffix = total && total > 1 ? ` of ${total}` : "";
  return `${series} · Book ${index}${suffix}`;
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-xs">
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

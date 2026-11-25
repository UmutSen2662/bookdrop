import { GripVertical, Pin } from "lucide-react";
import { BookCover } from "@/components/BookCover";
import { isOutsideLibrary } from "@/lib/outside";
import { cn } from "@/lib/utils";
import type { Book } from "@/pipeline/types";

type DragState = {
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

type Props = {
  book: Book;
  selected: boolean;
  homeDir: string;
  libraryDir: string;
  onSelect: (book: Book) => void;
  onTogglePin: (book: Book) => void;
  onOpen: (book: Book) => void;
  drag?: DragState;
};

export function BookCard({
  book,
  selected,
  homeDir,
  libraryDir,
  onSelect,
  onTogglePin,
  onOpen,
  drag,
}: Props) {
  const outside = !book.missing && isOutsideLibrary(book, libraryDir);
  return (
    <div
      id={`book-${book.id}`}
      data-book-id={book.id}
      className={cn(
        "group relative rounded-md transition",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        drag?.dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(book)}
        onDoubleClick={(event) => {
          event.preventDefault();
          onOpen(book);
        }}
        aria-pressed={selected}
        className="block w-full rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="relative block aspect-[2/3] overflow-hidden rounded-md border bg-muted shadow-sm">
          <BookCover
            bookId={book.id}
            title={book.title}
            homeDir={homeDir}
            updatedAt={book.updatedAt}
          />

          <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {book.missing && (
              <span
                className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
                title="The library file is missing"
              >
                file missing
              </span>
            )}
            {book.status === "needs_review" && (
              <span className="rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 shadow-sm">
                needs review
              </span>
            )}
            {outside && (
              <span
                className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 shadow-sm ring-1 ring-amber-500/40 backdrop-blur dark:text-amber-300"
                title="The file is in a different folder"
              >
                outside library
              </span>
            )}
          </span>
        </span>

        <span className="mt-1 px-1 line-clamp-2 text-sm font-medium leading-snug">
          {book.title || "Untitled"}
        </span>
        <span className="my-0.5 block truncate px-1 text-xs text-muted-foreground">
          {book.authors || "Unknown author"}
        </span>
      </button>

      <button
        type="button"
        aria-label={book.pinned ? "Unpin book" : "Pin book"}
        title={book.pinned ? "Unpin" : "Pin"}
        onClick={() => onTogglePin(book)}
        className="absolute right-2 top-2 rounded-full bg-background/85 p-1.5 text-foreground/80 opacity-0 shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Pin
          className={cn("size-3.5", book.pinned && "fill-current")}
          aria-hidden
        />
      </button>

      {drag && (
        <button
          type="button"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          onPointerDown={drag.onPointerDown}
          className={cn(
            "absolute right-2 top-10 cursor-grab touch-none rounded-full bg-background/85 p-1.5 text-foreground/80 shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground active:cursor-grabbing focus-visible:opacity-100",
            drag.dragging
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

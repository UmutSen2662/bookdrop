import { BookOpen, Loader2 } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LAYOUT } from "../lib/layout";
import { moveId } from "../lib/reorder";
import type { PendingIngest, ScrollRequest } from "../lib/useLibrary";
import type { Book } from "../pipeline/types";
import { BookCard } from "./BookCard";
import { Button } from "./ui/button";

type Props = {
  books: Book[];
  pending: PendingIngest[];
  selectedId: number | null;
  homeDir: string;
  libraryDir: string;
  hasQuery: boolean;
  hasFilter: boolean;
  scrollRequest: ScrollRequest | null;
  onSelect: (book: Book) => void;
  onTogglePin: (book: Book) => void;
  onOpen: (book: Book) => void;
  onReorderPinned?: (ids: number[]) => Promise<void> | void;
  onClearSearch: () => void;
  onClearFilters: () => void;
};

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${LAYOUT.cardMinWidth}px, 1fr))`,
  columnGap: LAYOUT.gridGapX,
  rowGap: LAYOUT.gridGapY,
};

export function BookGrid({
  books,
  pending,
  selectedId,
  homeDir,
  libraryDir,
  hasQuery,
  hasFilter,
  scrollRequest,
  onSelect,
  onTogglePin,
  onOpen,
  onReorderPinned,
  onClearSearch,
  onClearFilters,
}: Props) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const dragOrderRef = useRef<number[] | null>(null);
  const initialOrderRef = useRef<number[] | null>(null);

  const pinnedAll = books.filter((book) => book.pinned);
  const pinned = dragOrder
    ? dragOrder
        .map((id) => pinnedAll.find((book) => book.id === id))
        .filter((book): book is Book => Boolean(book))
    : pinnedAll;
  const rest = books.filter((book) => !book.pinned);
  const canReorder =
    Boolean(onReorderPinned) && !hasQuery && !hasFilter && pinned.length > 1;

  const stopDragging = useCallback(() => {
    setDraggedId(null);
  }, []);

  const resetOrder = useCallback(() => {
    dragOrderRef.current = null;
    initialOrderRef.current = null;
    setDragOrder(null);
  }, []);

  const cancelDrag = useCallback(() => {
    stopDragging();
    resetOrder();
  }, [resetOrder, stopDragging]);

  function startPointerDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    book: Book,
  ) {
    if (!canReorder || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const ids = pinned.map((entry) => entry.id);
    dragOrderRef.current = ids;
    initialOrderRef.current = ids;
    setDragOrder(ids);
    setDraggedId(book.id);
  }

  useEffect(() => {
    if (draggedId === null) return;
    const dragId = draggedId;

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    function onMove(event: PointerEvent) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const card = element?.closest<HTMLElement>("[data-book-id]");
      const id = card?.dataset.bookId ? Number(card.dataset.bookId) : null;
      const ids = dragOrderRef.current;
      if (id === null || id === dragId || !ids?.includes(id)) return;

      // Move the real card now, not on release. The grid reflows under the
      // pointer immediately, like reordering apps on a phone home screen.
      const next = moveId(ids, dragId, id);
      if (next !== ids) {
        dragOrderRef.current = next;
        setDragOrder(next);
      }
    }

    function finish() {
      const finalOrder = dragOrderRef.current;
      const initialOrder = initialOrderRef.current;
      const changed = Boolean(
        finalOrder &&
          initialOrder &&
          finalOrder.join(",") !== initialOrder.join(","),
      );

      stopDragging();
      if (changed && finalOrder && onReorderPinned) {
        void Promise.resolve(onReorderPinned(finalOrder)).finally(resetOrder);
      } else {
        resetOrder();
      }
    }

    function abort() {
      cancelDrag();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") cancelDrag();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", onKey);
    };
  }, [draggedId, onReorderPinned, cancelDrag, resetOrder, stopDragging]);

  useEffect(() => {
    if (!scrollRequest) return;
    const element = document.getElementById(`book-${scrollRequest.id}`);
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollRequest]);

  const lastPendingKey = pending[pending.length - 1]?.key;
  useEffect(() => {
    if (!lastPendingKey) return;
    document
      .getElementById(`pending-${lastPendingKey}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lastPendingKey]);

  if (books.length === 0 && pending.length === 0) {
    if (hasQuery || hasFilter) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
          <p className="text-sm text-muted-foreground">No books match</p>
          <Button
            variant="outline"
            size="sm"
            onClick={hasFilter ? onClearFilters : onClearSearch}
          >
            {hasFilter ? "Clear filters" : "Clear search"}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/25 px-8 py-24 text-center">
          <BookOpen className="size-8 text-muted-foreground/70" aria-hidden />
          <p className="text-base font-medium">Drop a book anywhere</p>
          <p className="text-sm text-muted-foreground">
            EPUB, PDF, MOBI, AZW3, RTF, DOCX, HTML, or TXT.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-[1500px] pb-28 pt-6"
      style={{ paddingLeft: LAYOUT.gridPadX, paddingRight: LAYOUT.gridPadX }}
    >
      {pending.length > 0 && (
        <section className="mb-8">
          <div style={GRID}>
            {pending.map((entry) => (
              <div
                key={entry.key}
                id={`pending-${entry.key}`}
                data-pending
                className="opacity-65"
              >
                <div className="flex aspect-[2/3] items-center justify-center rounded-lg border border-dashed bg-muted/40">
                  <Loader2
                    className="size-6 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium">
                  {entry.name}
                </p>
                <p className="text-xs text-muted-foreground">Preparing…</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {pinned.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pinned
          </h2>
          <div style={GRID}>
            {pinned.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                selected={selectedId === book.id}
                homeDir={homeDir}
                libraryDir={libraryDir}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
                onOpen={onOpen}
                drag={
                  canReorder
                    ? {
                        dragging: draggedId === book.id,
                        onPointerDown: (event) => startPointerDrag(event, book),
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {pinned.length > 0 && rest.length > 0 && (
        <div className="my-7 h-px bg-border" />
      )}

      {rest.length > 0 && (
        <section>
          <div style={GRID}>
            {rest.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                selected={selectedId === book.id}
                homeDir={homeDir}
                libraryDir={libraryDir}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

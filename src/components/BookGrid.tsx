import { BookOpen, Loader2, SearchX } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BookCard } from "@/components/BookCard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EYEBROW } from "@/components/ui/typography";
import { LAYOUT } from "@/lib/layout";
import { moveId } from "@/lib/reorder";
import type { PendingIngest, ScrollRequest } from "@/lib/useLibrary";
import type { Book } from "@/pipeline/types";

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
  // Fixed tracks: widening the window adds a column instead of stretching
  // every cover. Any width that cannot hold another card stays on the right.
  gridTemplateColumns: `repeat(auto-fill, ${LAYOUT.cardWidth}px)`,
  justifyContent: "start",
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

  function renderCard(book: Book) {
    return (
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
          book.pinned && canReorder
            ? {
                dragging: draggedId === book.id,
                onPointerDown: (event) => startPointerDrag(event, book),
              }
            : undefined
        }
      />
    );
  }

  if (books.length === 0 && pending.length === 0) {
    if (hasQuery || hasFilter) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={SearchX}
            title="No books match"
            description={
              hasFilter
                ? "Turn a review option off to see the rest of the library."
                : "Try a different title or author."
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={hasFilter ? onClearFilters : onClearSearch}
              >
                {hasFilter ? "Show all" : "Clear search"}
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <EmptyState
          variant="full"
          icon={BookOpen}
          title="Drop a book anywhere"
          description="EPUB, PDF, MOBI, AZW3, RTF, DOCX, HTML, or TXT."
        />
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full pb-10 pt-6"
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
                <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">
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
          <h2 className={`${EYEBROW} mb-3`}>Pinned</h2>
          <div style={GRID}>{pinned.map(renderCard)}</div>
        </section>
      )}

      {pinned.length > 0 && rest.length > 0 && (
        <div className="my-7 h-px bg-border" />
      )}

      {rest.length > 0 && (
        <section>
          <div style={GRID}>{rest.map(renderCard)}</div>
        </section>
      )}
    </div>
  );
}

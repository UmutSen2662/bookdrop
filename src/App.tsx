import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookGrid } from "@/components/BookGrid";
import { BookPanel } from "@/components/BookPanel";
import { BookSheet } from "@/components/BookSheet";
import { CoverLightbox } from "@/components/CoverLightbox";
import { FirstRun } from "@/components/FirstRun";
import { Footer } from "@/components/Footer";
import { RemoveDialog } from "@/components/RemoveDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LAYOUT, WIDE_BREAKPOINT } from "@/lib/layout";
import { CALIBRE_DOWNLOAD_URL } from "@/lib/links";
import { isOutsideLibrary, normalizedFolder } from "@/lib/outside";
import { bookMatches, parseQuery } from "@/lib/search";
import { sortBooks } from "@/lib/sort";
import { parseTags } from "@/lib/tags";
import { useLibrary } from "@/lib/useLibrary";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useOpds } from "@/lib/useOpds";
import { dirname } from "@/pipeline/paths";
import type { Book } from "@/pipeline/types";

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

function distinctSorted(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (!value) continue;
    const key = value.toLocaleLowerCase("en-US");
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()].sort((left, right) =>
    left.localeCompare(right, "en-US", { sensitivity: "base" }),
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removingBook, setRemovingBook] = useState<Book | null>(null);
  const [coverViewBook, setCoverViewBook] = useState<Book | null>(null);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [missingCoverOnly, setMissingCoverOnly] = useState(false);
  const [outsideDismissedFor, setOutsideDismissedFor] = useState<string | null>(
    null,
  );

  const wide = useMediaQuery(`(min-width: ${WIDE_BREAKPOINT}px)`);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const library = useLibrary({
    // A toast says "Show"/"Review": clear whatever would keep the book hidden.
    onShow: (_book, edit) => {
      setQuery("");
      setNeedsReviewOnly(false);
      setMissingCoverOnly(false);
      if (edit) setEditing(true);
    },
  });

  const ingestRef = useRef(library.ingestPaths);
  ingestRef.current = library.ingestPaths;

  const share = useOpds(library.books, library.config?.homeDir ?? "");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 100);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A sheet or dialog owns the keyboard while it is open.
      if (editing || settingsOpen || removingBook || coverViewBook) return;

      const typing = isTextField(event.target);

      if (
        (event.key === "/" && !typing) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (event.key === "Escape") {
        if (attentionOpen) {
          setAttentionOpen(false);
          return;
        }
        // Escape clears the search or selection, but a text field such as the
        // notes box keeps its own Escape.
        if (typing && event.target !== searchRef.current) return;
        if (query) {
          setQuery("");
        } else if (library.selectedId !== null) {
          library.setSelectedId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    query,
    settingsOpen,
    attentionOpen,
    editing,
    removingBook,
    coverViewBook,
    library.selectedId,
    library.setSelectedId,
  ]);

  // Explorer drag-and-drop arrives through Tauri's native event, not the
  // webview's HTML5 `drop` (which never sees a file path).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else if (payload.type === "drop") {
          setDragging(false);
          if (payload.paths.length > 0) {
            void ingestRef.current(payload.paths);
          }
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Returning from Explorer after deleting or restoring a file should update
  // the grid without a restart. This is a stat-only pass.
  useEffect(() => {
    const onFocus = () => void library.refreshMissing();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [library.refreshMissing]);

  // Sanitized descriptions can contain http(s) links. The webview must never
  // navigate to one; hand it to the system browser instead.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href || !/^https?:\/\//iu.test(href)) return;
      event.preventDefault();
      void openUrl(href).catch(() => undefined);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const tokens = useMemo(() => parseQuery(debounced), [debounced]);
  const sortBy = library.config?.sortBy ?? "author";
  const filtered = useMemo(() => {
    const matching = library.books.filter(
      (book) =>
        book.status !== "flagged" &&
        (!needsReviewOnly || book.status === "needs_review") &&
        (!missingCoverOnly || !book.hasCover) &&
        bookMatches(book, tokens),
    );
    // Pinned books keep their drag order; the chosen sort applies only below.
    const pinned = matching.filter((book) => book.pinned);
    const rest = matching.filter((book) => !book.pinned);
    return [...pinned, ...sortBooks(rest, sortBy)];
  }, [library.books, tokens, needsReviewOnly, missingCoverOnly, sortBy]);
  const flagged = useMemo(
    () => library.books.filter((book) => book.status === "flagged"),
    [library.books],
  );
  const missing = useMemo(
    () => library.books.filter((book) => book.missing),
    [library.books],
  );
  const libraryDir = library.config?.libraryDir ?? "";
  // A file that still exists in an old folder is not missing; it is just no
  // longer in the folder the app is scanning.
  const outsideBooks = useMemo(
    () =>
      library.books.filter(
        (book) => !book.missing && isOutsideLibrary(book, libraryDir),
      ),
    [library.books, libraryDir],
  );
  const outsideFolder = useMemo(() => {
    const folders = new Map<string, string>();
    for (const book of outsideBooks) {
      if (!book.libraryPath) continue;
      const folder = dirname(book.libraryPath);
      const key = normalizedFolder(folder);
      if (!folders.has(key)) folders.set(key, folder);
    }
    return folders.size === 1 ? [...folders.values()][0] : null;
  }, [outsideBooks]);

  // A new library folder is a new warning, even if this one was dismissed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: libraryDir is the intended trigger.
  useEffect(() => {
    setOutsideDismissedFor(null);
  }, [libraryDir]);
  const needsReviewCount = useMemo(
    () => library.books.filter((book) => book.status === "needs_review").length,
    [library.books],
  );
  const missingCoverCount = useMemo(
    () =>
      library.books.filter(
        (book) => book.status !== "flagged" && !book.hasCover,
      ).length,
    [library.books],
  );

  useEffect(() => {
    // Dismissing the last flagged or missing book unmounts the popover; clear
    // its state so the next problem does not pop it open by itself.
    if (flagged.length === 0 && missing.length === 0) setAttentionOpen(false);
  }, [flagged.length, missing.length]);

  const selectedBook = useMemo(
    () =>
      library.books.find(
        (book) => book.id === library.selectedId && book.status !== "flagged",
      ) ?? null,
    [library.books, library.selectedId],
  );

  // The library is the best source of spelling for tags and series names;
  // reusing an existing value is what keeps them from fragmenting.
  const tagSuggestions = useMemo(
    () => distinctSorted(library.books.flatMap((book) => parseTags(book.tags))),
    [library.books],
  );

  const seriesSuggestions = useMemo(
    () => distinctSorted(library.books.map((book) => book.series)),
    [library.books],
  );

  const seriesTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of library.books) {
      if (!book.series) continue;
      const key = book.series.toLocaleLowerCase("en-US");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [library.books]);

  const selectedSeriesTotal = selectedBook?.series
    ? seriesTotals.get(selectedBook.series.toLocaleLowerCase("en-US"))
    : undefined;

  useEffect(() => {
    // A removed or externally refreshed selection must not leave the edit
    // sheet armed for the next book.
    if (!selectedBook) setEditing(false);
  }, [selectedBook]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || settingsOpen || removingBook || coverViewBook) return;
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        return;
      }

      if (isTextField(event.target)) return;
      if (filtered.length === 0) return;

      const cards = Array.from(
        document.querySelectorAll<HTMLElement>("[data-book-id]"),
      );
      if (cards.length === 0) return;

      const activeCard = (
        document.activeElement as HTMLElement | null
      )?.closest<HTMLElement>("[data-book-id]");
      let currentId = activeCard?.dataset.bookId
        ? Number(activeCard.dataset.bookId)
        : library.selectedId;
      if (
        currentId === null ||
        !filtered.some((book) => book.id === currentId)
      ) {
        currentId = null;
      }

      event.preventDefault();
      let nextId: number | null = null;

      if (currentId === null) {
        nextId = filtered[0].id;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const index = filtered.findIndex((book) => book.id === currentId);
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const next = filtered[index + offset];
        if (index >= 0 && next) nextId = next.id;
      } else {
        const current = cards.find(
          (card) => Number(card.dataset.bookId) === currentId,
        );
        if (!current) {
          nextId = filtered[0].id;
        } else {
          const currentRect = current.getBoundingClientRect();
          const rows = new Map<number, HTMLElement[]>();
          for (const card of cards) {
            const rect = card.getBoundingClientRect();
            let key = [...rows.keys()].find(
              (rowTop) => Math.abs(rowTop - rect.top) < 8,
            );
            if (key === undefined) {
              key = rect.top;
              rows.set(key, []);
            }
            rows.get(key)?.push(card);
          }

          const rowTops = [...rows.keys()].sort((left, right) => left - right);
          const currentRow = rowTops.findIndex(
            (rowTop) => Math.abs(rowTop - currentRect.top) < 8,
          );
          const targetRow = currentRow + (event.key === "ArrowDown" ? 1 : -1);
          if (targetRow >= 0 && targetRow < rowTops.length) {
            const center = currentRect.left + currentRect.width / 2;
            let best: HTMLElement | null = null;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (const card of rows.get(rowTops[targetRow]) ?? []) {
              const rect = card.getBoundingClientRect();
              const distance = Math.abs(rect.left + rect.width / 2 - center);
              if (distance < bestDistance) {
                bestDistance = distance;
                best = card;
              }
            }
            if (best?.dataset.bookId) nextId = Number(best.dataset.bookId);
          }
        }
      }

      if (nextId === null) return;
      library.setSelectedId(nextId);
      requestAnimationFrame(() => {
        document
          .getElementById(`book-${nextId}`)
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus();
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    filtered,
    editing,
    settingsOpen,
    removingBook,
    coverViewBook,
    library.selectedId,
    library.setSelectedId,
  ]);

  // calibre problems have their own banner above the grid. Duplicates would
  // only repeat the same line in the footer popover.
  const startupNotices = [
    ...new Set(
      library.issues.filter(
        (issue) => !issue.toLowerCase().includes("calibre"),
      ),
    ),
  ];

  if (library.phase === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening the library…
        </div>
      </div>
    );
  }

  if (library.phase === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-base font-semibold">
            Could not open the library
          </h1>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {library.error ?? "Unknown error"}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (library.phase === "first-run") {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <FirstRun onChoose={library.chooseLibraryFolder} />
        <Toasts toasts={library.toasts} onDismiss={library.dismissToast} />
      </div>
    );
  }

  const config = library.config;
  if (!config) {
    return null;
  }

  const panelProps = {
    homeDir: config.homeDir,
    libraryDir,
    seriesTotal: selectedSeriesTotal,
    onEdit: () => setEditing(true),
    onRemove: setRemovingBook,
    onOpenCover: setCoverViewBook,
    onOpen: (book: Book) => void library.openBook(book),
    onOpenFolder: (book: Book) => void library.openBookFolder(book),
    onRecheck: (book: Book) => void library.recheckBook(book),
    onSaveReading: library.saveBookReading,
  };

  return (
    <div
      className="flex h-screen overflow-hidden bg-background text-foreground"
      onDragOver={(event) => {
        event.preventDefault();
        if (isTauri()) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 border-4 border-primary/40 bg-primary/5">
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border bg-background/90 px-5 py-3 text-sm font-medium shadow-lg">
              {library.install
                ? "Drop to add to the library"
                : "calibre is not available"}
            </div>
          </div>
        </div>
      )}

      <div
        className="mx-auto flex h-full w-full min-w-0"
        style={{ maxWidth: LAYOUT.appMaxWidth }}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            query={query}
            onQueryChange={setQuery}
            searchRef={searchRef}
            sortBy={sortBy}
            onSortChange={(value) => {
              void library
                .saveSettings({ sortBy: value })
                .catch(() => undefined);
            }}
            needsReviewOnly={needsReviewOnly}
            needsReviewCount={needsReviewCount}
            onToggleNeedsReview={() =>
              setNeedsReviewOnly((current) => !current)
            }
            missingCoverOnly={missingCoverOnly}
            missingCoverCount={missingCoverCount}
            onToggleMissingCover={() =>
              setMissingCoverOnly((current) => !current)
            }
            flagged={flagged}
            missing={missing}
            attentionOpen={attentionOpen}
            onAttentionOpenChange={setAttentionOpen}
            onShow={(book) => {
              setAttentionOpen(false);
              library.showBook(book);
            }}
            onRetry={(book) => {
              setAttentionOpen(false);
              void library.retryFlagged(book);
            }}
            onDismiss={(book) => void library.dismiss(book)}
            onOpenSettings={() => {
              setAttentionOpen(false);
              setSettingsOpen(true);
            }}
            queue={library.queue}
          />

          {!library.install && (
            <div className="border-b bg-amber-500/10 px-4 py-2">
              <div className="flex w-full items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                <span className="min-w-0 flex-1">
                  calibre was not found. Dropping is disabled until it is on
                  PATH or configured.
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void library.recheckCalibre()}
                >
                  <RefreshCw aria-hidden />
                  Re-check
                </Button>
                <Button
                  size="xs"
                  variant="link"
                  onClick={() => {
                    void openUrl(CALIBRE_DOWNLOAD_URL).catch(() => undefined);
                  }}
                >
                  Download calibre
                </Button>
              </div>
            </div>
          )}

          {outsideBooks.length > 0 && outsideDismissedFor !== libraryDir && (
            <div className="border-b bg-amber-500/10 px-4 py-2">
              <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 text-xs text-amber-800 dark:text-amber-200">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {outsideBooks.length} book
                    {outsideBooks.length === 1 ? " is" : "s are"} outside the
                    current library folder.
                  </p>
                  <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/80">
                    {outsideFolder ? (
                      <>
                        They are still in{" "}
                        <span className="break-all font-mono">
                          {outsideFolder}
                        </span>
                        .{" "}
                      </>
                    ) : (
                      "They are still in other folders. "
                    )}
                    Move the files into the current library folder (don't copy)
                    and Bookdrop re-attaches them on the next start.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {outsideFolder && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        const first = outsideBooks[0];
                        if (first) void library.openBookFolder(first);
                      }}
                    >
                      Open old folder
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Settings
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dismiss this notice"
                    onClick={() => setOutsideDismissedFor(libraryDir)}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <main className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div
                className="flex min-h-full flex-col"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (
                    target.closest("[data-book-id], [data-pending]") ||
                    target.closest("button, a, input, textarea, select")
                  ) {
                    return;
                  }
                  if (library.selectedId !== null) library.setSelectedId(null);
                }}
              >
                <BookGrid
                  books={filtered}
                  pending={library.pending}
                  selectedId={library.selectedId}
                  homeDir={config.homeDir}
                  libraryDir={libraryDir}
                  hasQuery={debounced.trim().length > 0}
                  hasFilter={needsReviewOnly || missingCoverOnly}
                  scrollRequest={library.scrollRequest}
                  onSelect={(book) => library.setSelectedId(book.id)}
                  onTogglePin={(book) => void library.togglePin(book)}
                  onOpen={(book) => void library.openBook(book)}
                  onReorderPinned={(ids) => library.reorderPinned(ids)}
                  onClearSearch={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  onClearFilters={() => {
                    setQuery("");
                    setNeedsReviewOnly(false);
                    setMissingCoverOnly(false);
                    searchRef.current?.focus();
                  }}
                />
              </div>
            </ScrollArea>
          </main>

          <Footer
            notices={startupNotices}
            share={share.supported ? share : null}
            onUpdateError={(title, detail) =>
              library.pushToast({ title, detail, tone: "error" })
            }
          />
        </div>

        {wide && (
          <aside
            className="h-full shrink-0 border-l bg-background"
            style={{ width: LAYOUT.panelWidth }}
          >
            <BookPanel
              key={selectedBook?.id ?? "empty"}
              book={selectedBook}
              {...panelProps}
            />
          </aside>
        )}
      </div>

      {!wide && selectedBook && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40"
          onClick={() => library.setSelectedId(null)}
        >
          <aside
            className="h-full border-l bg-background shadow-2xl"
            style={{ width: `min(${LAYOUT.panelWidth}px, 92vw)` }}
            onClick={(event) => event.stopPropagation()}
          >
            <BookPanel
              key={selectedBook.id}
              book={selectedBook}
              {...panelProps}
            />
          </aside>
        </div>
      )}

      {editing && selectedBook && library.host && (
        <BookSheet
          key={selectedBook.id}
          book={selectedBook}
          homeDir={config.homeDir}
          host={library.host}
          tagSuggestions={tagSuggestions}
          seriesSuggestions={seriesSuggestions}
          onClose={() => setEditing(false)}
          onRefresh={() => library.refreshBookMetadata(selectedBook)}
          onCoverSize={library.readCoverSize}
          onSave={(metadata, coverPath, candidates) =>
            library
              .saveBookEdit(selectedBook, metadata, coverPath, candidates)
              .then(() => undefined)
          }
        />
      )}

      {removingBook && (
        <RemoveDialog
          book={removingBook}
          onClose={() => setRemovingBook(null)}
          onRemove={async (deleteArchive) => {
            await library.remove(removingBook, { deleteArchive });
            setRemovingBook(null);
            setEditing(false);
          }}
        />
      )}

      {coverViewBook && (
        <CoverLightbox
          book={coverViewBook}
          homeDir={config.homeDir}
          onEnsureFull={library.loadFullCover}
          onClose={() => setCoverViewBook(null)}
        />
      )}

      {settingsOpen && library.host && (
        <SettingsDialog
          config={config}
          host={library.host}
          install={library.install}
          books={library.books}
          onClose={() => setSettingsOpen(false)}
          onSave={library.saveSettings}
          onRecheck={library.recheckCalibre}
          onPlanRenames={library.planRenames}
          onRenameLibrary={library.renameLibrary}
        />
      )}

      <Toasts toasts={library.toasts} onDismiss={library.dismissToast} />
    </div>
  );
}

export default App;

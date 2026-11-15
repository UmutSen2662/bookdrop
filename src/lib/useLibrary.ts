/**
 * The app's one piece of state: the pipeline, the loaded books, pending drops,
 * and toasts. The pipeline owns every write; this hook only calls it.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CalibreInstall, findCalibre } from "../pipeline/calibre";
import { type Config, loadConfig, saveConfig } from "../pipeline/config";
import type { BookStore } from "../pipeline/db";
import { openTauriStore } from "../pipeline/db.tauri";
import { errorMessage } from "../pipeline/errors";
import type { Host } from "../pipeline/host";
import { createTauriHost, primeEnv } from "../pipeline/host.tauri";
import { ingestFile } from "../pipeline/ingest";
import {
  applyLibraryRenames,
  checkBookFile,
  editBook as editBookOnDisk,
  ensureFullCover as ensureFullCoverOnDisk,
  markMissingFiles,
  planLibraryRenames,
  type RemoveOptions,
  type RenamePlan,
  readCoverSize as readCoverSizeOnDisk,
  refreshBookMetadata as refreshBookMetadataOnDisk,
  removeBook,
  saveReading as saveReadingOnDisk,
  startup,
} from "../pipeline/library";
import {
  basename,
  dirname,
  joinPath,
  toForwardSlashes,
} from "../pipeline/paths";
import type { Book, Candidates, Metadata, ReadStatus } from "../pipeline/types";
import { reasonLabel } from "./format";

type LibraryPhase = "loading" | "first-run" | "ready" | "error";

type ToastTone = "success" | "warning" | "error" | "info";

export type Toast = {
  id: number;
  title: string;
  detail?: string;
  tone: ToastTone;
  actions: Array<{ label: string; run: () => void }>;
};

export type PendingIngest = {
  key: string;
  name: string;
};

type IngestItem = PendingIngest & {
  path: string;
};

export type QueueProgress = {
  done: number;
  total: number;
};

export type ScrollRequest = {
  id: number;
  nonce: number;
};

const ENV_NAMES = [
  "BOOKDROP_HOME",
  "BOOKDROP_LIBRARY",
  "BOOKDROP_ARCHIVE",
  "BOOKDROP_ORIGINALS",
  "BOOKDROP_FETCH",
  "BOOKDROP_CLEAN",
  "BOOKDROP_COVERS",
  "BOOKDROP_CALIBRE",
  "BOOKDROP_TEMPLATE",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "HOME",
];

function forward(path: string): string {
  return toForwardSlashes(path.trim()).replace(/\/+$/u, "");
}

type Options = {
  /** Clear the search and select a book; used by toast actions. */
  onShow: (book: Book, edit?: boolean) => void;
};

export function useLibrary(options: Options) {
  const [phase, setPhase] = useState<LibraryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<Host | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [install, setInstall] = useState<CalibreInstall | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [pending, setPending] = useState<PendingIngest[]>([]);
  const [queue, setQueue] = useState<QueueProgress | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(
    null,
  );

  const hostRef = useRef<Host | null>(null);
  const configRef = useRef<Config | null>(null);
  const storeRef = useRef<BookStore | null>(null);
  const installRef = useRef<CalibreInstall | null>(null);
  const startedRef = useRef(false);
  const toastIdRef = useRef(0);
  const pendingKeyRef = useRef(0);
  const ingestQueueRef = useRef<IngestItem[]>([]);
  const ingestRunningRef = useRef(false);
  const renameRunningRef = useRef(false);
  const startupRunningRef = useRef(false);
  const sessionDoneRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const showRef = useRef(options.onShow);
  showRef.current = options.onShow;

  const pushToast = useCallback(
    (
      toast: Omit<Toast, "id" | "actions"> & Partial<Pick<Toast, "actions">>,
    ) => {
      const id = ++toastIdRef.current;
      setToasts((current) => [...current, { actions: [], ...toast, id }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((entry) => entry.id !== id));
      }, 7_000);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const refresh = useCallback(async (target?: BookStore | null) => {
    const active = target ?? storeRef.current;
    if (!active) return;
    setBooks(await active.list());
  }, []);

  const reveal = useCallback((book: Book, edit = false) => {
    showRef.current(book, edit);
    setSelectedId(book.id);
    setScrollRequest({ id: book.id, nonce: Date.now() });
  }, []);

  const boot = useCallback(
    async (nextHost: Host, nextConfig: Config) => {
      setPhase("loading");
      setError(null);
      setIssues([]);
      // Row ids are per database, so an old selection can point at a different
      // book after the library folder changes.
      setSelectedId(null);
      setScrollRequest(null);

      const previous = storeRef.current;
      if (previous) {
        await previous.close().catch(() => undefined);
        storeRef.current = null;
      }

      await nextHost.ensureDir(nextConfig.homeDir);
      const nextStore = await openTauriStore(
        joinPath(nextConfig.homeDir, "db.sqlite"),
      );
      storeRef.current = nextStore;
      hostRef.current = nextHost;
      configRef.current = nextConfig;
      setHost(nextHost);
      setConfig(nextConfig);
      startupRunningRef.current = true;

      let found: CalibreInstall | null = null;
      try {
        found = await findCalibre(nextHost, nextConfig.calibreDir);
      } catch (calibreError) {
        setIssues((current) => [...current, errorMessage(calibreError)]);
      }
      installRef.current = found;
      setInstall(found);

      const report = await startup(
        nextHost,
        nextConfig,
        nextStore,
        found,
      ).finally(() => {
        startupRunningRef.current = false;
      });
      if (report.problems.length > 0) {
        setIssues((current) => [...current, ...report.problems]);
      }
      await refresh(nextStore);
      setPhase("ready");
    },
    [refresh],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        if (!isTauri()) {
          throw new Error("Run this inside the Tauri app: bun tauri dev");
        }
        await primeEnv(ENV_NAMES);
        const nextHost = createTauriHost();
        hostRef.current = nextHost;
        setHost(nextHost);
        const nextConfig = await loadConfig(nextHost);
        configRef.current = nextConfig;
        setConfig(nextConfig);
        if (!nextConfig.libraryDir) {
          setPhase("first-run");
          return;
        }
        await boot(nextHost, nextConfig);
      } catch (startError) {
        setError(errorMessage(startError));
        setPhase("error");
      }
    })();
  }, [boot]);

  const saveSettings = useCallback(
    async (patch: Partial<Config>) => {
      const activeHost = hostRef.current;
      const current = configRef.current;
      if (!activeHost || !current) return;
      const next: Config = {
        ...current,
        ...patch,
        ...(patch.libraryDir ? { libraryDir: forward(patch.libraryDir) } : {}),
        ...(patch.originalsDir
          ? { originalsDir: forward(patch.originalsDir) }
          : {}),
        ...(patch.calibreDir !== undefined
          ? {
              calibreDir: patch.calibreDir ? forward(patch.calibreDir) : null,
            }
          : {}),
      };
      const libraryChanged = next.libraryDir !== current.libraryDir;
      const calibreChanged = next.calibreDir !== current.calibreDir;

      // Changing folders closes the current store. Let long-running jobs finish
      // first so they are never writing through a closed connection.
      if (libraryChanged && ingestRunningRef.current) {
        throw new Error(
          "Wait for the current ingest to finish before changing the library folder.",
        );
      }
      if (libraryChanged && renameRunningRef.current) {
        throw new Error(
          "Wait for the current rename to finish before changing the library folder.",
        );
      }
      if (libraryChanged && startupRunningRef.current) {
        throw new Error(
          "Wait for the library check to finish before changing the library folder.",
        );
      }
      if (libraryChanged) {
        const info = await activeHost.stat(next.libraryDir);
        if (!info?.isDirectory) {
          throw new Error(`Library folder does not exist: ${next.libraryDir}`);
        }
      }

      // An explicit override must work before it is saved. Resetting to
      // detection may legitimately come back empty; that shows the banner.
      let nextInstall: CalibreInstall | null | undefined;
      if (calibreChanged) {
        try {
          nextInstall = await findCalibre(activeHost, next.calibreDir);
        } catch (calibreError) {
          if (next.calibreDir) {
            throw new Error(
              `calibre was not found at that folder: ${errorMessage(calibreError)}`,
            );
          }
          nextInstall = null;
        }
      }

      await saveConfig(activeHost, next);
      configRef.current = next;
      setConfig(next);

      if (libraryChanged) {
        try {
          await boot(activeHost, next);
        } catch (bootError) {
          setError(errorMessage(bootError));
          setPhase("error");
          throw bootError;
        }
      } else if (calibreChanged) {
        installRef.current = nextInstall ?? null;
        setInstall(nextInstall ?? null);
        if (!nextInstall) {
          pushToast({
            title: "calibre was not found",
            detail: "Install calibre, or set a folder in Settings.",
            tone: "error",
          });
        }
      }
    },
    [boot, pushToast],
  );

  const chooseLibraryFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose the library folder",
    });
    if (typeof selected !== "string") return;
    try {
      await saveSettings({ libraryDir: selected });
    } catch (error_) {
      // There is no Settings dialog yet on first run, so surface it here.
      setError(errorMessage(error_));
      setPhase("error");
    }
  }, [saveSettings]);

  const recheckCalibre = useCallback(async () => {
    const activeHost = hostRef.current;
    const current = configRef.current;
    if (!activeHost || !current) return;
    if (ingestRunningRef.current || renameRunningRef.current) {
      pushToast({
        title: "Wait for the current job to finish",
        detail: "Re-checking calibre rescans the library.",
        tone: "info",
      });
      return;
    }
    if (startupRunningRef.current) {
      pushToast({
        title: "The library is already being checked",
        tone: "info",
      });
      return;
    }

    startupRunningRef.current = true;
    let found: CalibreInstall;
    try {
      found = await findCalibre(activeHost, current.calibreDir);
    } catch (calibreError) {
      startupRunningRef.current = false;
      installRef.current = null;
      setInstall(null);
      pushToast({
        title: "calibre not found",
        detail: errorMessage(calibreError),
        tone: "error",
      });
      return;
    }

    installRef.current = found;
    setInstall(found);
    setIssues((currentIssues) =>
      currentIssues.filter((issue) => !issue.includes("calibre")),
    );
    pushToast({
      title: `calibre ${found.version} found`,
      detail: found.dir,
      tone: "success",
    });

    const activeStore = storeRef.current;
    if (!activeStore) {
      startupRunningRef.current = false;
      return;
    }
    try {
      const report = await startup(
        activeHost,
        current,
        activeStore,
        found,
      ).finally(() => {
        startupRunningRef.current = false;
      });
      if (report.problems.length > 0) setIssues(report.problems);
      await refresh(activeStore);
    } catch (refreshError) {
      pushToast({
        title: "Could not refresh the library",
        detail: errorMessage(refreshError),
        tone: "error",
      });
    }
  }, [pushToast, refresh]);

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      const activeHost = hostRef.current;
      const activeConfig = configRef.current;
      const activeStore = storeRef.current;
      if (!activeHost || !activeConfig || !activeStore) return;
      if (paths.length === 0) return;
      if (startupRunningRef.current || renameRunningRef.current) {
        pushToast({
          title: "Wait for the current job to finish",
          detail: "Drop the file again once it finishes.",
          tone: "info",
        });
        return;
      }
      if (!installRef.current) {
        pushToast({
          title: "calibre is not available",
          detail: "Install calibre or fix the path in Settings, then re-check.",
          tone: "error",
        });
        return;
      }

      // Every dropped file gets a card immediately. Only one calibre job runs
      // at a time; a second drop while one is running joins the same backlog.
      const install = installRef.current;
      const items: IngestItem[] = paths.map((path) => ({
        key: `ingest-${++pendingKeyRef.current}`,
        path,
        name: basename(path),
      }));
      setPending((current) => [
        ...current,
        ...items.map(({ key, name }) => ({ key, name })),
      ]);
      ingestQueueRef.current.push(...items);
      sessionTotalRef.current += items.length;
      setQueue({
        done: sessionDoneRef.current,
        total: sessionTotalRef.current,
      });

      if (ingestRunningRef.current) return;
      ingestRunningRef.current = true;

      try {
        for (;;) {
          const item = ingestQueueRef.current.shift();
          if (!item) break;
          try {
            const outcome = await ingestFile(
              activeHost,
              activeConfig,
              item.path,
              {
                install,
                store: activeStore,
              },
            );
            await refresh(activeStore);

            if (outcome.duplicate && outcome.book) {
              const book = outcome.book;
              if (book.missing) {
                pushToast({
                  title: `Missing file: ${book.title || item.name}`,
                  detail:
                    "Restore it in the library folder, or use Recheck in the book panel.",
                  tone: "warning",
                  actions: [{ label: "Show", run: () => reveal(book) }],
                });
              } else {
                pushToast({
                  title: `Already in library: ${book.title || item.name}`,
                  tone: "info",
                  actions: [{ label: "Show", run: () => reveal(book) }],
                });
              }
            } else if (outcome.status === "flagged") {
              pushToast({
                title: `Skipped: ${reasonLabel(outcome.flagReason)}`,
                detail: item.name,
                tone: "warning",
              });
            } else {
              const title = outcome.metadata?.title || item.name;
              const actions: Toast["actions"] = [];
              if (outcome.book) {
                const book = outcome.book;
                actions.push({ label: "Show", run: () => reveal(book) });
                if (outcome.status === "needs_review") {
                  actions.push({
                    label: "Review",
                    run: () => reveal(book, true),
                  });
                }
                setScrollRequest({ id: book.id, nonce: Date.now() });
              }
              pushToast({
                title: `Added ${title}`,
                detail: outcome.cleanWarning,
                tone:
                  outcome.cleanWarning || outcome.status === "needs_review"
                    ? "warning"
                    : "success",
                actions,
              });
            }
          } catch (ingestError) {
            pushToast({
              title: `Could not ingest ${item.name}`,
              detail: errorMessage(ingestError),
              tone: "error",
            });
          } finally {
            setPending((current) =>
              current.filter((entry) => entry.key !== item.key),
            );
            sessionDoneRef.current += 1;
            setQueue({
              done: sessionDoneRef.current,
              total: sessionTotalRef.current,
            });
          }
        }
      } finally {
        ingestRunningRef.current = false;
        if (ingestQueueRef.current.length === 0) {
          sessionDoneRef.current = 0;
          sessionTotalRef.current = 0;
          setQueue(null);
        }
      }
    },
    [pushToast, refresh, reveal],
  );

  const retryFlagged = useCallback(
    async (book: Book) => {
      if (!book.archivedPath) {
        pushToast({
          title: "Nothing to retry",
          detail: "No archive copy was kept. Drop the original file again.",
          tone: "info",
        });
        return;
      }
      const archived = await hostRef.current?.stat(book.archivedPath);
      if (!archived) {
        pushToast({
          title: "The archive copy is missing",
          detail: "Drop the original file again.",
          tone: "warning",
        });
        return;
      }
      await ingestPaths([book.archivedPath]);
    },
    [ingestPaths, pushToast],
  );

  const togglePin = useCallback(
    async (book: Book) => {
      const active = storeRef.current;
      if (!active) return;
      await active.setPinned(book.id, !book.pinned);
      await refresh(active);
    },
    [refresh],
  );

  const reorderPinned = useCallback(
    async (ids: number[]) => {
      const active = storeRef.current;
      if (!active) return;
      try {
        await active.reorderPinned(ids);
        await refresh(active);
      } catch (error) {
        pushToast({
          title: "Could not reorder the pinned books",
          detail: errorMessage(error),
          tone: "error",
        });
      }
    },
    [pushToast, refresh],
  );

  const openBook = useCallback(
    async (book: Book) => {
      if (!book.libraryPath) return;
      const activeHost = hostRef.current;
      const activeStore = storeRef.current;
      let current: Book | null = null;
      if (activeHost && activeStore) {
        current = await checkBookFile(activeHost, activeStore, book);
        // The flag changed while trying to open it; let the grid catch up.
        if ((current === null) !== book.missing) await refresh(activeStore);
      }
      if (!current?.libraryPath) {
        pushToast({
          title: "The library file is missing",
          detail: book.libraryPath,
          tone: "warning",
        });
        return;
      }
      try {
        await invoke("open_path", { path: current.libraryPath });
      } catch (error) {
        pushToast({
          title: "Could not open the book",
          detail: errorMessage(error),
          tone: "error",
        });
      }
    },
    [pushToast, refresh],
  );

  /** The panel's Recheck: the user says the file is back at its old path. */
  const recheckBook = useCallback(
    async (book: Book) => {
      const activeHost = hostRef.current;
      const activeStore = storeRef.current;
      if (!activeHost || !activeStore || !book.libraryPath) return null;
      const found = await checkBookFile(activeHost, activeStore, book);
      await refresh(activeStore);
      if (!found) {
        pushToast({
          title: "Still missing",
          detail: book.libraryPath,
          tone: "warning",
        });
        return null;
      }
      pushToast({
        title: "File found",
        detail: basename(book.libraryPath),
        tone: "success",
      });
      return found;
    },
    [pushToast, refresh],
  );

  const openBookFolder = useCallback(
    async (book: Book) => {
      if (!book.libraryPath) return;
      try {
        await invoke("open_path", { path: dirname(book.libraryPath) });
      } catch (error) {
        pushToast({
          title: "Could not open the folder",
          detail: errorMessage(error),
          tone: "error",
        });
      }
    },
    [pushToast],
  );

  /**
   * A cheap stat-only pass when the window regains focus, so a file deleted or
   * restored in Explorer shows up without a restart.
   */
  const refreshMissing = useCallback(async () => {
    const activeHost = hostRef.current;
    const activeConfig = configRef.current;
    const activeStore = storeRef.current;
    if (!activeHost || !activeConfig || !activeStore) return;
    // A rename stages files under temporary names; checking in the middle
    // would see every moved book as missing.
    if (ingestRunningRef.current || renameRunningRef.current) return;
    try {
      const report = await markMissingFiles(
        activeHost,
        activeConfig,
        activeStore,
      );
      if (report.changed > 0) await refresh(activeStore);
    } catch {
      // Changing the library folder closes the store; this pass is optional.
    }
  }, [refresh]);

  const saveBookEdit = useCallback(
    async (
      book: Book,
      metadata: Metadata,
      coverPath?: string,
      candidates?: Candidates,
    ) => {
      const activeHost = hostRef.current;
      const activeConfig = configRef.current;
      const activeStore = storeRef.current;
      const activeInstall = installRef.current;
      if (!activeHost || !activeConfig || !activeStore) {
        throw new Error("The library is not open.");
      }
      if (!activeInstall) {
        throw new Error("calibre is not available.");
      }
      const updated = await editBookOnDisk(
        activeHost,
        activeConfig,
        activeStore,
        activeInstall,
        book,
        { metadata, coverPath, candidates },
      );
      await refresh(activeStore);
      pushToast({
        title: "Saved",
        detail: updated.title || "The book was updated.",
        tone: "success",
      });
      return updated;
    },
    [pushToast, refresh],
  );

  const loadFullCover = useCallback(async (book: Book) => {
    const activeHost = hostRef.current;
    const activeConfig = configRef.current;
    if (!activeHost || !activeConfig) return null;
    return ensureFullCoverOnDisk(
      activeHost,
      activeConfig,
      installRef.current,
      book,
    );
  }, []);

  const refreshBookMetadata = useCallback(async (book: Book) => {
    const activeHost = hostRef.current;
    const activeConfig = configRef.current;
    const activeInstall = installRef.current;
    if (!activeHost || !activeConfig) {
      throw new Error("The library is not open.");
    }
    if (!activeInstall) throw new Error("calibre is not available.");
    return refreshBookMetadataOnDisk(
      activeHost,
      activeConfig,
      activeInstall,
      book,
    );
  }, []);

  const readCoverSize = useCallback(async (book: Book) => {
    const activeHost = hostRef.current;
    const activeConfig = configRef.current;
    if (!activeHost || !activeConfig) return null;
    return readCoverSizeOnDisk(
      activeHost,
      activeConfig,
      installRef.current,
      book,
    );
  }, []);

  const planRenames = useCallback(async (template: string) => {
    const activeHost = hostRef.current;
    const activeConfig = configRef.current;
    const activeStore = storeRef.current;
    if (!activeHost || !activeConfig || !activeStore) {
      throw new Error("The library is not open.");
    }
    return planLibraryRenames(activeHost, activeConfig, activeStore, template);
  }, []);

  const renameLibrary = useCallback(
    async (plan: RenamePlan) => {
      const activeHost = hostRef.current;
      const activeConfig = configRef.current;
      const activeStore = storeRef.current;
      if (!activeHost || !activeConfig || !activeStore) {
        throw new Error("The library is not open.");
      }
      if (ingestRunningRef.current) {
        throw new Error("Wait for the current ingest to finish, then rename.");
      }
      if (startupRunningRef.current) {
        throw new Error("Wait for the library check to finish, then rename.");
      }
      renameRunningRef.current = true;
      try {
        const report = await applyLibraryRenames(
          activeHost,
          activeConfig,
          activeStore,
          plan,
        );
        await refresh(activeStore);
        if (report.renamed > 0) {
          pushToast({
            title: `Renamed ${report.renamed} file${report.renamed === 1 ? "" : "s"}`,
            detail:
              report.problems.length > 0
                ? `${report.problems.length} did not move; see Settings.`
                : undefined,
            tone: report.problems.length > 0 ? "warning" : "success",
          });
        }
        return report;
      } finally {
        renameRunningRef.current = false;
      }
    },
    [pushToast, refresh],
  );

  /** Silent by design: the book panel shows "Saving…"/"Saved" and errors. */
  const saveBookReading = useCallback(
    async (
      book: Book,
      reading: { status: ReadStatus; notes: string | null },
    ) => {
      const activeStore = storeRef.current;
      if (!activeStore) throw new Error("The library is not open.");
      const updated = await saveReadingOnDisk(activeStore, book.id, reading);
      await refresh(activeStore);
      return updated;
    },
    [refresh],
  );

  const remove = useCallback(
    async (book: Book, removal: RemoveOptions = {}) => {
      const activeHost = hostRef.current;
      const activeConfig = configRef.current;
      const active = storeRef.current;
      if (!activeHost || !activeConfig || !active) return;
      await removeBook(activeHost, activeConfig, active, book, removal);
      if (selectedId === book.id) setSelectedId(null);
      await refresh(active);
    },
    [refresh, selectedId],
  );

  const dismiss = useCallback(
    async (book: Book) => {
      const active = storeRef.current;
      if (!active) return;
      await active.remove(book.id);
      await refresh(active);
    },
    [refresh],
  );

  return {
    phase,
    error,
    host,
    config,
    install,
    books,
    pending,
    queue,
    toasts,
    issues,
    selectedId,
    scrollRequest,
    setSelectedId,
    showBook: reveal,
    dismissToast,
    chooseLibraryFolder,
    saveSettings,
    recheckCalibre,
    ingestPaths,
    retryFlagged,
    togglePin,
    reorderPinned,
    openBook,
    openBookFolder,
    recheckBook,
    refreshMissing,
    saveBookEdit,
    saveBookReading,
    loadFullCover,
    refreshBookMetadata,
    readCoverSize,
    planRenames,
    renameLibrary,
    remove,
    dismiss,
  };
}

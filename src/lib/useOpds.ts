import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../pipeline/errors";
import type { Book } from "../pipeline/types";
import { type ShareBook, shareEntries } from "./opds";

/** One reachable origin and the adapter that owns it. */
export type ShareAddress = { url: string; name: string };

/** What the Rust commands return. */
type WireStatus =
  | { state: "stopped" }
  | { state: "running"; urls: ShareAddress[]; count: number };

export type ShareState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running"; urls: ShareAddress[]; count: number }
  | { kind: "failed"; message: string };

export type ShareController = {
  supported: boolean;
  state: ShareState;
  start: () => void;
  stop: () => void;
  /** Re-read status; the adapter list can change while sharing. */
  refresh: () => void;
};

/**
 * The footer's share control. The server lives in Rust; this keeps the
 * snapshot in sync, owns the four visible states, and stays out of the way
 * when the app runs in a plain browser (`bun run dev`).
 */
export function useOpds(books: Book[], homeDir: string): ShareController {
  const supported = isTauri();
  const [state, setState] = useState<ShareState>({ kind: "stopped" });
  const entries = useMemo(() => shareEntries(books, homeDir), [books, homeDir]);

  const entriesRef = useRef<ShareBook[]>(entries);
  entriesRef.current = entries;

  const apply = useCallback((status: WireStatus) => {
    setState(
      status.state === "running"
        ? {
            kind: "running",
            urls: status.urls,
            count: status.count,
          }
        : { kind: "stopped" },
    );
  }, []);

  // A webview reload during development must not leave an invisible server
  // behind: adopt whatever the Rust side already has. The same call keeps the
  // adapter list honest after a network change.
  const refresh = useCallback(() => {
    if (!supported) return;
    invoke<WireStatus>("share_status")
      .then(apply)
      .catch(() => undefined);
  }, [supported, apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const start = useCallback(() => {
    if (!supported) return;
    setState({ kind: "starting" });
    invoke<WireStatus>("start_sharing", { books: entriesRef.current })
      .then(apply)
      .catch((error: unknown) =>
        setState({ kind: "failed", message: errorMessage(error) }),
      );
  }, [supported, apply]);

  const stop = useCallback(() => {
    if (!supported) return;
    invoke<WireStatus>("stop_sharing")
      .then(apply)
      .catch(() => setState({ kind: "stopped" }));
  }, [supported, apply]);

  // New drops, edits, and removals reach the reader without a restart. The
  // server is the only writer of its copy, so this is a cheap replacement.
  useEffect(() => {
    if (state.kind !== "running") return;
    invoke("set_share_books", { books: entries }).catch(() => undefined);
  }, [entries, state.kind]);

  // Keep the visible count tied to the current snapshot: books dropped or
  // removed while sharing change it without a restart.
  const visible: ShareState =
    state.kind === "running" ? { ...state, count: entries.length } : state;

  return { supported, state: visible, start, stop, refresh };
}

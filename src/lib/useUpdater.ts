import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/pipeline/errors";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing"; percent: number | null };

/** How long "Up to date" stays visible before returning to the button. */
const CURRENT_NOTICE_MS = 5_000;
/** Let the library finish opening before the launch check hits the network. */
const LAUNCH_CHECK_DELAY_MS = 2_500;

type Options = {
  /** Only failures the user asked for reach the app; the launch check is quiet. */
  onError: (title: string, detail?: string) => void;
};

/**
 * Update checks for the footer. A check either finds an update (which stays
 * visible until installed) or reports the current version briefly. Clicking
 * "Update available" downloads, installs, and reopens the app in one go.
 */
export function useUpdater({ onError }: Options) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const revertRef = useRef<number | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const clearRevert = useCallback(() => {
    if (revertRef.current !== null) {
      window.clearTimeout(revertRef.current);
      revertRef.current = null;
    }
  }, []);

  // Cancel the "Up to date" timer if the footer goes away mid-countdown.
  useEffect(() => clearRevert, [clearRevert]);

  const runCheck = useCallback(
    async (silent: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      clearRevert();
      setState({ kind: "checking" });

      try {
        const update = await check({ timeout: 10_000 });
        updateRef.current = update;
        if (update) {
          setState({ kind: "available", version: update.version });
        } else {
          setState({ kind: "current" });
          revertRef.current = window.setTimeout(() => {
            revertRef.current = null;
            setState({ kind: "idle" });
          }, CURRENT_NOTICE_MS);
        }
      } catch (error) {
        setState({ kind: "idle" });
        if (!silent) {
          errorRef.current("Couldn't check for updates.", errorMessage(error));
        }
      } finally {
        busyRef.current = false;
      }
    },
    [clearRevert],
  );

  const checkForUpdates = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    clearRevert();
    setState({ kind: "installing", percent: 0 });

    try {
      let total = 0;
      let downloaded = 0;
      // On Windows, a successful install exits the app and the installer
      // reopens it on the new version.
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setState({ kind: "installing", percent: 0 });
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({
            kind: "installing",
            percent:
              total > 0
                ? Math.min(100, Math.round((downloaded / total) * 100))
                : null,
          });
          return;
        }
        setState({ kind: "installing", percent: 100 });
      });
    } catch (error) {
      setState({ kind: "available", version: update.version });
      errorRef.current("Couldn't install the update.", errorMessage(error));
    } finally {
      busyRef.current = false;
    }
  }, [clearRevert]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runCheck(true);
    }, LAUNCH_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  return { state, checkForUpdates, install };
}

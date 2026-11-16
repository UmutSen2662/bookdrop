import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

/**
 * The app version from the Tauri bundle. Null until it resolves, and outside
 * Tauri (plain browser dev) where the IPC call rejects.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}

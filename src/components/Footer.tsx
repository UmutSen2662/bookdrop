import { cn } from "@/lib/utils";
import { useAppVersion } from "../lib/useAppVersion";
import type { ShareController } from "../lib/useOpds";
import { type UpdateState, useUpdater } from "../lib/useUpdater";
import { ShareButton } from "./ShareMenu";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

type Props = {
  /** Startup notices that do not belong in a blocking banner. */
  notices: string[];
  /** Null outside Tauri, where there is no server to start. */
  share: ShareController | null;
  onUpdateError: (title: string, detail?: string) => void;
};

function labelFor(state: UpdateState): string {
  switch (state.kind) {
    case "checking":
      return "Checking…";
    case "current":
      return "Up to date";
    case "available":
      return "Update available";
    case "installing":
      return state.percent === null
        ? "Downloading…"
        : `Downloading… ${state.percent}%`;
    default:
      return "Check for updates";
  }
}

/**
 * The quiet row under the grid: sharing and startup notices on the left, app
 * version and the update check on the right. There is no confirmation dialog;
 * clicking "Update available" downloads, installs, and reopens the app in one
 * step.
 */
export function Footer({ notices, share, onUpdateError }: Props) {
  const version = useAppVersion();
  const { state, checkForUpdates, install } = useUpdater({
    onError: onUpdateError,
  });
  const actionable = state.kind === "idle" || state.kind === "available";

  return (
    <footer className="shrink-0 border-t bg-background">
      <div className="mx-auto flex h-9 w-full max-w-[1500px] items-center gap-4 px-4 text-xs text-muted-foreground">
        {share && (
          <span aria-live="polite" className="flex items-center">
            <ShareButton
              state={share.state}
              onStart={share.start}
              onStop={share.stop}
              onRefresh={share.refresh}
            />
          </span>
        )}
        {notices.length > 0 && (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className={share ? "" : "-ml-2"}
                />
              }
            >
              {notices.length} startup{" "}
              {notices.length === 1 ? "notice" : "notices"}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              className="w-[24rem] max-w-[calc(100vw-2rem)] gap-0 p-0"
            >
              <div className="border-b px-3 py-2">
                <PopoverTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Startup notices
                </PopoverTitle>
              </div>
              <ul className="max-h-[40vh] divide-y overflow-y-auto">
                {notices.map((notice) => (
                  <li
                    key={notice}
                    className="whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed"
                  >
                    {notice}
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span aria-live="polite" className="flex items-center">
            {actionable ? (
              <Button
                variant="ghost"
                size="xs"
                title={
                  state.kind === "available"
                    ? `Version ${state.version} is ready to install`
                    : undefined
                }
                className={cn(
                  "-mx-1.5 px-1.5",
                  state.kind === "available" && "font-medium text-primary",
                )}
                onClick={() =>
                  state.kind === "available"
                    ? void install()
                    : checkForUpdates()
                }
              >
                {labelFor(state)}
              </Button>
            ) : (
              <span
                className={state.kind === "installing" ? "tabular-nums" : ""}
              >
                {labelFor(state)}
              </span>
            )}
          </span>
          {version && (
            <>
              <span aria-hidden className="text-muted-foreground/60">
                •
              </span>
              <span className="tabular-nums">v{version}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}

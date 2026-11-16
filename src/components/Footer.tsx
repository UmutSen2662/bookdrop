import { RELEASES_URL } from "../lib/links";
import { useAppVersion } from "../lib/useAppVersion";
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
};

/**
 * The quiet row under the grid: startup notices on the left, app version and
 * the releases link on the right. The releases link is a plain anchor that the
 * app hands to the system browser until the in-app updater exists.
 */
export function Footer({ notices }: Props) {
  const version = useAppVersion();

  return (
    <footer className="shrink-0 border-t bg-background">
      <div className="mx-auto flex h-9 w-full max-w-[1500px] items-center gap-3 px-4 text-xs text-muted-foreground">
        {notices.length > 0 && (
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="xs" className="-ml-2" />}
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
          <a
            href={RELEASES_URL}
            className="rounded-sm underline-offset-2 hover:text-foreground hover:underline"
          >
            Releases
          </a>
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

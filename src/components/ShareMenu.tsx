import { useEffect, useRef, useState } from "react";
import type { ShareAddress, ShareState } from "../lib/useOpds";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

type Props = {
  state: ShareState;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
};

/**
 * The footer's whole share surface: one quiet control, one popover. Stopping
 * is one click away, and the address is always shown as selectable text — an
 * e-reader has no camera and no clipboard, so the user types it.
 */
export function ShareButton({ state, onStart, onStop, onRefresh }: Props) {
  if (state.kind === "starting") {
    return (
      <span className="-ml-2 px-2" aria-live="polite">
        Starting…
      </span>
    );
  }

  if (state.kind === "failed") {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2 px-2 font-medium text-destructive"
            />
          }
        >
          Sharing failed
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-80">
          <PopoverTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Sharing failed
          </PopoverTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state.message}
          </p>
          <div>
            <Button size="xs" variant="outline" onClick={onStart}>
              Try again
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (state.kind === "running") {
    const address = hostOf(state.urls[0]?.url);
    return (
      <Popover
        onOpenChange={(open) => {
          if (open) onRefresh();
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2 gap-1.5 px-2"
              title="Sharing over Wi-Fi — click for the address"
            />
          }
        >
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          <span className="tabular-nums">{address ?? "No network"}</span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-[26rem] max-w-[calc(100vw-2rem)] gap-0 p-0"
        >
          <div className="border-b px-3 py-2">
            <PopoverTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Share over Wi-Fi
            </PopoverTitle>
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <div className="space-y-1.5">
              {state.urls.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No network connection.
                </p>
              ) : (
                state.urls.map((address) => (
                  <UrlRow key={address.url} address={address} />
                ))
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              In KOReader: search → OPDS catalog → Add catalog → paste this
              address.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {state.count} {state.count === 1 ? "book" : "books"} · anyone on
              this Wi-Fi can browse and download them.
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              If the reader can't connect, allow Bookdrop through Windows
              Firewall.
            </p>
          </div>
          <div className="border-t px-3 py-2">
            <Button size="xs" variant="outline" onClick={onStop}>
              Stop sharing
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Button variant="ghost" size="xs" className="-ml-2 px-2" onClick={onStart}>
      Share over Wi-Fi
    </Button>
  );
}

function UrlRow({ address }: { address: ShareAddress }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const timer = useRef<number | null>(null);
  const href = `${address.url}/opds`;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="space-y-0.5">
      <p
        className="truncate text-[11px] font-medium text-muted-foreground"
        title={address.name}
      >
        {address.name}
      </p>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate font-mono text-[11px]"
          title={href}
        >
          {href}
        </code>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0"
          onClick={() => {
            void copyText(href).then((ok) => {
              setCopied(ok ? "ok" : "failed");
              if (timer.current !== null) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied("idle"), 1500);
            });
          }}
        >
          {copied === "ok"
            ? "Copied"
            : copied === "failed"
              ? "Copy failed"
              : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//u, "");
}

/**
 * WebView2 can refuse the async clipboard when the document lacks focus; the
 * selection fallback keeps the button useful either way.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

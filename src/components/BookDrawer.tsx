import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LAYOUT } from "@/lib/layout";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Props = {
  /** A child dialog (edit, remove, cover) is on top and owns the keyboard. */
  blocked?: boolean;
  /** Card id to focus when the drawer closes, e.g. `book-12`. */
  returnFocusTo: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The narrow-window book panel. App marks the page behind it inert; this
 * component starts focus on the drawer, loops Tab inside it, and closes on
 * Escape even from the notes field. The visible chrome stays the floating X;
 * the dialog role lives on the overlay around the scrim and panel.
 */
export function BookDrawer({
  blocked = false,
  returnFocusTo,
  onClose,
  children,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    const overlay = overlayRef.current;
    const previous = document.activeElement as HTMLElement | null;
    overlay?.focus();

    return () => {
      // If a child dialog is closing the drawer (for example after removing
      // the book), let that dialog keep control of focus.
      if (blockedRef.current) return;
      const card = document.getElementById(returnFocusRef.current);
      const target = card?.querySelector<HTMLElement>("button") ?? previous;
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusable = Array.from(
      overlay.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      overlay.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || active === overlay) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-panel-title"
      tabIndex={-1}
      inert={blocked || undefined}
      className="fixed inset-0 z-40 flex bg-black/40 outline-none"
      onKeyDown={onKeyDown}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a presentational backdrop. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer convenience; Escape and the close button cover the keyboard. */}
      <div
        className="flex min-w-0 flex-1 items-start justify-end"
        onClick={onClose}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close book details"
          title="Close (Esc)"
          className="mt-3 mr-3 bg-background/90 text-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur hover:bg-background hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X aria-hidden />
        </Button>
      </div>
      <aside
        className="h-full shrink-0 border-l bg-background shadow-2xl"
        style={{ width: `min(${LAYOUT.panelWidth}px, 92vw)` }}
      >
        {children}
      </aside>
    </div>
  );
}

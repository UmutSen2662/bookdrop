import { RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PopoverTitle } from "@/components/ui/popover";
import { POPOVER_LABEL } from "@/components/ui/typography";
import { formatDate, reasonLabel } from "@/lib/format";
import { basename } from "@/pipeline/paths";
import type { Book } from "@/pipeline/types";

type Props = {
  flagged: Book[];
  missing: Book[];
  onShow: (book: Book) => void;
  onRetry: (book: Book) => void;
  onDismiss: (book: Book) => void;
  onClose: () => void;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="border-b bg-muted/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

export function NeedsAttention({
  flagged,
  missing,
  onShow,
  onRetry,
  onDismiss,
  onClose,
}: Props) {
  return (
    <>
      <div className="border-b px-3 py-2">
        <PopoverTitle className={POPOVER_LABEL}>Needs attention</PopoverTitle>
      </div>

      {flagged.length > 0 && (
        <section>
          {missing.length > 0 && <SectionTitle>Failed imports</SectionTitle>}
          <ul className="max-h-[32vh] divide-y overflow-y-auto">
            {flagged.map((book) => (
              <li key={book.id} className="px-3 py-3">
                <p
                  className="truncate text-sm font-medium"
                  title={book.sourcePath ?? ""}
                >
                  {book.sourcePath ? basename(book.sourcePath) : "Unknown file"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {reasonLabel(book.flagReason)}
                  {book.addedAt ? ` · ${formatDate(book.addedAt)}` : ""}
                </p>
                {book.error && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                    {book.error}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {book.archivedPath ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onRetry(book)}
                    >
                      <RotateCcw aria-hidden />
                      Retry
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      Drop the file again to retry
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => onDismiss(book)}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <section>
          <SectionTitle>Missing files</SectionTitle>
          <ul className="max-h-[32vh] divide-y overflow-y-auto">
            {missing.map((book) => (
              <li key={book.id} className="px-3 py-3">
                <p className="truncate text-sm font-medium">
                  {book.title || "Untitled"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {book.authors || "Unknown author"}
                </p>
                <p
                  className="mt-1 line-clamp-2 break-all text-[11px] text-muted-foreground/80"
                  title={book.libraryPath ?? ""}
                >
                  {book.libraryPath}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Put the file back at this path, then use Recheck in the panel.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onShow(book)}
                  >
                    Show
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end border-t px-2 py-1.5">
        <Button size="xs" variant="ghost" onClick={onClose}>
          <X aria-hidden />
          Close
        </Button>
      </div>
    </>
  );
}

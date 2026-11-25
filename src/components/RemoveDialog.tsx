import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/pipeline/errors";
import type { Book } from "@/pipeline/types";

type Props = {
  book: Book;
  onClose: () => void;
  onRemove: (deleteArchive: boolean) => Promise<void>;
};

export function RemoveDialog({ book, onClose, onRemove }: Props) {
  const [deleteArchive, setDeleteArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove(deleteArchive);
      onClose();
    } catch (removeError) {
      setError(errorMessage(removeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={false} size="md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Remove this book?</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {book.title || "Untitled"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <DialogDescription className="mt-4 text-sm text-muted-foreground">
          {book.missing
            ? "The library file is already missing. This removes the book, its cached cover, and its reading notes."
            : "This removes the book from the library, including its cached cover, candidate covers, and reading notes. If the EPUB is still in the library folder, it is deleted too."}{" "}
          The source file you originally dropped is never touched.
        </DialogDescription>

        {book.archivedPath && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={deleteArchive}
              onCheckedChange={setDeleteArchive}
            />
            Also delete the archived copy
          </label>
        )}

        {error && <Callout className="mt-3">{error}</Callout>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void remove()}
            disabled={busy}
          >
            <Trash2 aria-hidden />
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

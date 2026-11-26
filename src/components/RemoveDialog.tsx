import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
      <DialogContent size="md">
        <DialogHeader
          title="Remove this book?"
          subtitle={book.title || "Untitled"}
          onClose={onClose}
          closeDisabled={busy}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <DialogDescription>
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void remove()}
            disabled={busy}
          >
            {busy ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

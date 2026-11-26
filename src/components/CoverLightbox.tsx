import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { demoCoverUrl, isDemoMode } from "@/demo/mode";
import { initials } from "@/lib/format";
import { joinPath } from "@/pipeline/paths";
import type { Book } from "@/pipeline/types";

type Props = {
  book: Book;
  homeDir: string;
  onEnsureFull: (book: Book) => Promise<string | null>;
  onClose: () => void;
};

export function CoverLightbox({ book, homeDir, onEnsureFull, onClose }: Props) {
  const demoSource = isDemoMode() ? demoCoverUrl(book.id) : null;
  const thumbnail =
    demoSource ??
    `${convertFileSrc(
      joinPath(homeDir, "covers", `${book.id}.jpg`),
    )}?v=${encodeURIComponent(book.updatedAt)}`;
  const [src, setSrc] = useState(thumbnail);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(thumbnail);
    setLoaded(false);
    setFailed(false);

    // Demo covers are already full size and bundled with the app.
    if (!demoSource) {
      void onEnsureFull(book)
        .then((path) => {
          if (cancelled || !path) return;
          setLoaded(false);
          setSrc(`${convertFileSrc(path)}?v=${Date.now()}`);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [book, thumbnail, demoSource, onEnsureFull]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-black/90"
        className="inset-0 top-0 left-0 max-h-none max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-transparent p-4 text-white shadow-none ring-0 sm:max-w-none"
        onClick={onClose}
      >
        <DialogTitle className="sr-only">
          Cover of {book.title || "book"}
        </DialogTitle>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          className="absolute right-4 top-4 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X aria-hidden />
        </Button>

        <div className="relative flex h-full w-full items-center justify-center">
          {failed ? (
            <div
              className="flex flex-col items-center gap-3 text-white/70"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-6xl font-semibold">
                {initials(book.title)}
              </span>
              <span className="text-sm">No cover image</span>
            </div>
          ) : (
            <>
              {!loaded && (
                <Loader2
                  className="absolute size-6 animate-spin text-white/70"
                  aria-hidden
                />
              )}
              <img
                src={src}
                alt={book.title}
                draggable={false}
                onLoad={() => setLoaded(true)}
                onClick={(event) => event.stopPropagation()}
                onError={() => {
                  if (src !== thumbnail) {
                    setLoaded(false);
                    setSrc(thumbnail);
                  } else {
                    setFailed(true);
                  }
                }}
                className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

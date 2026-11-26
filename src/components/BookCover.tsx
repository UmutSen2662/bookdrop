import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { demoCoverUrl, isDemoMode } from "@/demo/mode";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { joinPath } from "@/pipeline/paths";

type Props = {
  bookId: number;
  title: string;
  homeDir: string;
  /** Changes after a cover write, so the webview does not keep a stale image. */
  updatedAt: string;
  alt?: string;
  className?: string;
};

export function BookCover({
  bookId,
  title,
  homeDir,
  updatedAt,
  alt = "",
  className,
}: Props) {
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt triggers a fresh image.
  useEffect(() => {
    setFailed(false);
  }, [updatedAt]);

  if (failed) {
    return (
      <span
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-secondary",
          className,
        )}
      >
        <span className="text-3xl font-semibold tracking-tight text-muted-foreground/70">
          {initials(title)}
        </span>
      </span>
    );
  }

  const demoSource = isDemoMode() ? demoCoverUrl(bookId) : null;
  const source = demoSource ?? joinPath(homeDir, "covers", `${bookId}.jpg`);
  if (!source) {
    return (
      <span
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-secondary",
          className,
        )}
      >
        <span className="text-3xl font-semibold tracking-tight text-muted-foreground/70">
          {initials(title)}
        </span>
      </span>
    );
  }
  return (
    <img
      src={`${demoSource ? source : convertFileSrc(source)}?v=${encodeURIComponent(updatedAt)}`}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

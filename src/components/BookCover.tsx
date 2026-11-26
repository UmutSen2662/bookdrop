import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { EYEBROW } from "@/components/ui/typography";
import { demoCoverUrl, isDemoMode } from "@/demo/mode";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { joinPath } from "@/pipeline/paths";

type CoverVariant = "card" | "sheet" | "panel";

const PLATE = {
  card: {
    initials: "text-3xl",
    rule: "w-8",
    frame: "inset-2",
    gap: "gap-1.5",
  },
  sheet: {
    initials: "text-4xl",
    rule: "w-10",
    frame: "inset-3",
    gap: "gap-2",
  },
  panel: {
    initials: "text-5xl",
    rule: "w-12",
    frame: "inset-4",
    gap: "gap-2.5",
  },
} as const;

type Props = {
  bookId: number;
  title: string;
  homeDir: string;
  /** Changes after a cover write, so the webview does not keep a stale image. */
  updatedAt: string;
  alt?: string;
  className?: string;
  variant?: CoverVariant;
};

export function BookCover({
  bookId,
  title,
  homeDir,
  updatedAt,
  alt = "",
  className,
  variant = "card",
}: Props) {
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt triggers a fresh image.
  useEffect(() => {
    setFailed(false);
  }, [updatedAt]);

  if (failed) {
    return (
      <CoverFallback title={title} className={className} variant={variant} />
    );
  }

  const demoSource = isDemoMode() ? demoCoverUrl(bookId) : null;
  const source = demoSource ?? joinPath(homeDir, "covers", `${bookId}.jpg`);
  if (!source) {
    return (
      <CoverFallback title={title} className={className} variant={variant} />
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

function CoverFallback({
  title,
  className,
  variant,
}: {
  title: string;
  className?: string;
  variant: CoverVariant;
}) {
  const plate = PLATE[variant];

  return (
    <span
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-muted to-secondary",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-md border-2 border-foreground/15",
          plate.frame,
        )}
      />
      <span className={cn("relative flex flex-col items-center", plate.gap)}>
        <span
          aria-hidden
          className={cn(
            "font-serif font-bold tracking-tight text-foreground/70",
            plate.initials,
          )}
        >
          {initials(title)}
        </span>
        <span
          aria-hidden
          className={cn("h-px bg-muted-foreground/30", plate.rule)}
        />
        <span className={cn(EYEBROW, "text-muted-foreground/70")}>
          No cover
        </span>
      </span>
    </span>
  );
}

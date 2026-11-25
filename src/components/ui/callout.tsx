import type * as React from "react";
import { cn } from "@/lib/utils";

const TONES = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  muted: "border bg-muted/40 text-muted-foreground",
} as const;

/** The inline notice box used for warnings, errors, and muted hints. */
export function Callout({
  tone = "error",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: keyof typeof TONES }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

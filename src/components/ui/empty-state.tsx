import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one empty state: a muted icon, a title, one line of help, and an
 * optional action. `full` adds the dashed card used when the whole library is
 * empty; `compact` drops the chrome for panels and filtered results.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "compact",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  variant?: "compact" | "full";
  className?: string;
}) {
  const full = variant === "full";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        full
          ? "w-full max-w-2xl gap-2 rounded-2xl border border-dashed bg-muted/25 px-8 py-20"
          : "gap-2 px-6 py-16",
        className,
      )}
    >
      <Icon
        className={cn("text-muted-foreground/60", full ? "size-8" : "size-7")}
        aria-hidden
      />
      <p className={cn("font-medium", full ? "text-base" : "text-sm")}>
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "max-w-md text-muted-foreground",
            full ? "text-sm" : "text-xs",
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={cn(full ? "mt-2" : "mt-1")}>{action}</div>}
    </div>
  );
}

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Toast } from "@/lib/useLibrary";
import { cn } from "@/lib/utils";

type Props = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

const TONE = {
  success: {
    icon: CheckCircle2,
    className: "border-primary/30",
    iconClass: "text-primary",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-500/35",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: XCircle,
    className: "border-destructive/40",
    iconClass: "text-destructive",
  },
  info: {
    icon: Info,
    className: "border-border",
    iconClass: "text-muted-foreground",
  },
} as const;

export function Toasts({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  const visible = toasts.slice(-3);
  const hidden = toasts.length - visible.length;

  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-50 flex w-[23rem] flex-col gap-2">
      {hidden > 0 && (
        <p className="self-end text-xs text-muted-foreground">+{hidden} more</p>
      )}
      {visible.map((toast) => {
        const tone = TONE[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto animate-in fade-in slide-in-from-bottom-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg duration-200",
              tone.className,
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon
                className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">
                  {toast.title}
                </p>
                {toast.detail && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {toast.detail}
                  </p>
                )}
                {toast.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {toast.actions.map((action) => (
                      <Button
                        key={action.label}
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          action.run();
                          onDismiss(toast.id);
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => onDismiss(toast.id)}
                className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

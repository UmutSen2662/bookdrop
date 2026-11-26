import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-1.5 text-[11px] font-semibold leading-4 whitespace-nowrap tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        danger: "bg-destructive/10 text-destructive",
        primary: "bg-primary/15 text-primary",
      },
      solid: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { tone: "warning", solid: true, class: "bg-amber-500 text-amber-950" },
      { tone: "danger", solid: true, class: "bg-destructive text-white" },
    ],
    defaultVariants: { tone: "neutral", solid: false },
  },
);

function Badge({
  className,
  tone = "neutral",
  solid = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, solid }), className)}
      {...props}
    />
  );
}

export { Badge };

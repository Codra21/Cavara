import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Toggle as TogglePrimitive } from "@ui-sdk/react/toggle";

const toggleVariants = cva(
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-card px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        destructive:
          "data-pressed:border-transparent data-pressed:bg-destructive/10 data-pressed:text-destructive data-pressed:hover:bg-destructive/20 dark:data-pressed:bg-destructive/20 dark:data-pressed:hover:bg-destructive/30",
        warning:
          "data-pressed:border-warning-border data-pressed:bg-warning-soft data-pressed:text-warning data-pressed:hover:bg-warning-soft/80 dark:data-pressed:bg-warning-soft dark:data-pressed:hover:bg-warning-soft/80",
      },
    },
    defaultVariants: { tone: "destructive" },
  },
);

function Toggle({
  className,
  tone,
  ...props
}: Omit<React.ComponentProps<typeof TogglePrimitive>, "className"> &
  VariantProps<typeof toggleVariants> & { className?: string }) {
  return <TogglePrimitive className={cn(toggleVariants({ tone, className }))} {...props} />;
}

export { Toggle };

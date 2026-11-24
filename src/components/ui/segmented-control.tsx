import * as React from "react";
import { cn } from "cn";
import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";

function SegmentedControl<T extends string = string>({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SegmentedControlPrimitive<T>>, "className"> & { className?: string }) {
  return (
    <SegmentedControlPrimitive<T>
      className={cn("flex flex-wrap gap-1 rounded-lg bg-card p-1 ring-1 ring-border", className)}
      {...props}
    />
  );
}

function SegmentedControlItem({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SegmentedControlItemPrimitive>, "className"> & { className?: string }) {
  return (
    <SegmentedControlItemPrimitive
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] border border-transparent bg-clip-padding px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px data-disabled:pointer-events-none data-disabled:opacity-50 dark:hover:bg-muted/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        "data-checked:bg-primary data-checked:text-primary-foreground data-checked:hover:bg-primary/80 data-checked:hover:text-primary-foreground dark:data-checked:hover:bg-primary/80",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };

import * as React from "react"
import { cn } from "cn"
import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectGroupLabel,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectItemText,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
  type SelectProps as SelectPrimitiveProps,
} from "@ui-sdk/react/select"
import { ChevronDownIcon, CheckIcon } from "lucide-react"

type SelectRootProps = Omit<
  Exclude<SelectPrimitiveProps<string, false>, { multiple: true }>,
  "onValueChange"
> & {
  onValueChange?: (value: string) => void
}

function Select({ onValueChange, value, ...props }: SelectRootProps) {
  return (
    <SelectPrimitive
      modal
      {...props}
      value={value === "" ? null : value}
      onValueChange={(value) => {
        if (typeof value === "string") onValueChange?.(value)
      }}
    />
  )
}

function SelectGroup({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectGroupPrimitive>, "className"> & {
  className?: string
}) {
  return (
    <SelectGroupPrimitive
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectValuePrimitive>) {
  return <SelectValuePrimitive data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectTriggerPrimitive>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
  size?: "sm" | "default"
}) {
  return (
    <SelectTriggerPrimitive
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none size-4 text-muted-foreground"
      />
    </SelectTriggerPrimitive>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: Omit<React.ComponentProps<typeof SelectContentPrimitive>, "className"> & {
  className?: string
  position?: "item-aligned" | "popper"
}) {
  // 5px = trigger border and left padding (11px) minus item left padding (6px), so item text lines up with the trigger text.
  return (
    <SelectContentPrimitive
      data-slot="select-content"
      data-align-trigger={position === "item-aligned"}
      alignItemWithTrigger={position === "item-aligned"}
      alignOffset={position === "item-aligned" ? 5 : 0}
      align={align}
      className={cn("relative z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", position === "popper" ? "min-w-[max(9rem,var(--anchor-width))] data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1" : "min-w-[calc(var(--anchor-width)-5px)]", className )}
      {...props}
    >
      {children}
    </SelectContentPrimitive>
  )
}

function SelectLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectGroupLabel>, "className"> & {
  className?: string
}) {
  return (
    <SelectGroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  label,
  ...props
}: Omit<React.ComponentProps<typeof SelectItemPrimitive<string>>, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
}) {
  const parts = React.Children.toArray(children)
  const text = parts.every((part) => typeof part === "string" || typeof part === "number")
    ? parts.join("")
    : undefined

  return (
    <SelectItemPrimitive
      data-slot="select-item"
      label={label ?? text}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectItemIndicator>
          <CheckIcon aria-hidden="true" className="pointer-events-none" />
        </SelectItemIndicator>
      </span>
      <SelectItemText>{text ?? children}</SelectItemText>
    </SelectItemPrimitive>
  )
}

function SelectSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectSeparatorPrimitive>, "className"> & {
  className?: string
}) {
  return (
    <SelectSeparatorPrimitive
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

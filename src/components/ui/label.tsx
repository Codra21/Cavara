import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "@ui-sdk/react/label"

function Label({
  className,
  ...props
}: Omit<React.ComponentProps<typeof LabelPrimitive>, "className"> & { className?: string }) {
  return (
    <LabelPrimitive
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }

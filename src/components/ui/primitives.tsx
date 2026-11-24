import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import type { ReactNode } from "react";
import type { Availability } from "@/lib/types";

/** Font Awesome icon. `name` is the full class list, e.g. "fa-solid fa-bag-shopping". */
export function Icon({ name, className }: { name: string; className?: string }) {
  return <i className={className ? `${name} ${className}` : name} aria-hidden="true" />;
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`.trim()} aria-hidden="true">
      <span className="brand-mark" />
      <span className="brand-word" />
    </span>
  );
}

/** One-of-many colour picker. `value` is the selected colour's name; arrow keys move and select, as in any radio group. */
export function SwatchGroup({
  label,
  className,
  value,
  onValueChange,
  children,
}: {
  label: string;
  className: string;
  value: string;
  onValueChange: (name: string) => void;
  children: ReactNode;
}) {
  return (
    <RadioGroup
      className={className}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      {children}
    </RadioGroup>
  );
}

export function Swatch({
  variant,
  size = "small",
}: {
  /** A colour from a card, a detail object or the legacy catalogue. */
  variant: { name: string; swatch: string; availability?: Availability | undefined };
  size?: "small" | "large";
}) {
  const soldOut = variant.availability === "out_of_stock";
  return (
    <Radio
      className="swatch"
      value={variant.name}
      data-swatch-size={size}
      data-sold-out={soldOut ? "" : undefined}
      aria-label={`${variant.name}${soldOut ? ", out of stock" : ""}`}
      title={soldOut ? `${variant.name} (out of stock)` : variant.name}
    >
      <span style={{ background: variant.swatch }} />
    </Radio>
  );
}

export function Quantity({
  value,
  min = 1,
  max,
  label = "Quantity",
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  label?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="quantity" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={min > 0 && value <= min}>
        <Icon name="fa-solid fa-minus" />
        <SrOnly>Decrease quantity</SrOnly>
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max}>
        <Icon name="fa-solid fa-plus" />
        <SrOnly>Increase quantity</SrOnly>
      </button>
    </div>
  );
}

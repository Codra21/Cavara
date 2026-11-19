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

export function Swatch({
  variant,
  selected,
  size = "small",
  onSelect,
}: {
  /** A colour from a card, a detail object or the legacy catalogue. */
  variant: { name: string; swatch: string; availability?: Availability | undefined };
  selected: boolean;
  size?: "small" | "large";
  onSelect: () => void;
}) {
  const soldOut = variant.availability === "out_of_stock";
  return (
    <button
      className="swatch"
      type="button"
      data-swatch-size={size}
      data-sold-out={soldOut ? "" : undefined}
      aria-pressed={selected}
      aria-label={`${variant.name}${soldOut ? ", out of stock" : ""}${selected ? ", selected" : ""}`}
      title={soldOut ? `${variant.name} (out of stock)` : variant.name}
      onClick={onSelect}
    >
      <span style={{ background: variant.swatch }} />
    </button>
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

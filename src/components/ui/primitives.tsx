import { useId, type ReactNode } from "react";
import type { Variant } from "~/lib/types";

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

/** Circular badge with rotating ring text around a value. */
export function RoundBadge({ value, ringText, caption }: { value: string; ringText: string; caption?: string }) {
  const id = `badge-ring-${useId().replace(/:/g, "")}`;
  return (
    <span className="round-badge" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="round-badge-ring">
        <defs>
          <path id={id} d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
        </defs>
        <text>
          <textPath href={`#${id}`} textLength={236}>
            {ringText.toUpperCase()}
          </textPath>
        </text>
      </svg>
      <span className="round-badge-value">
        {value}
        {caption ? <small>{caption}</small> : null}
      </span>
    </span>
  );
}

export function Swatch({
  variant,
  selected,
  size = "small",
  onSelect,
}: {
  variant: Variant;
  selected: boolean;
  size?: "small" | "large";
  onSelect: () => void;
}) {
  return (
    <button
      className="swatch"
      type="button"
      data-swatch-size={size}
      aria-pressed={selected}
      aria-label={`${variant.name}${selected ? ", selected" : ""}`}
      title={variant.name}
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

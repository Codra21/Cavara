// Pure catalogue helpers. No React, no D1, no fetch.

const priceFormatter = new Intl.NumberFormat("en-US");
export const formatPrice = (value: number) => `৳ ${priceFormatter.format(value)}`;

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The colour at `index`, or the first one when the index is out of range. Works on any product shape with colours. */
export function getVariant<V>(product: { variants: [V, ...V[]] }, index = 0): V {
  return product.variants[index] ?? product.variants[0];
}

/** Lowercase words joined by single hyphens, as the editor writes them (see SLUG_PATTERN in product-admin.ts). */
export const isProductSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

/** Shape check for a category id in a URL; whether it exists is the listing's answer (a 404 when it does not). */
export const isCategorySlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);

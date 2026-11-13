// Which products a product page suggests. Pure: works on the summary's product list, so the server function that
// uses it reads no D1.
import type { ProductSummary } from "@/domain/catalog-snapshot";

/** The product page shows one row of four (`.pdp-grid`). */
export const RELATED_LIMIT = 4;

/**
 * Same-category products first, then others to fill the row. The list is rotated to start after the current product,
 * so two products in one category suggest different neighbours instead of every page showing the category's first four.
 * The order depends only on the list, so the answer caches like any other public read. Never includes the product.
 */
export function selectRelated<T extends Pick<ProductSummary, "id" | "category">>(
  products: T[],
  current: Pick<ProductSummary, "id" | "category">,
  limit = RELATED_LIMIT,
): T[] {
  const at = products.findIndex((product) => product.id === current.id);
  const rotated = at === -1 ? products : [...products.slice(at + 1), ...products.slice(0, at)];
  const others = rotated.filter((product) => product.id !== current.id);
  const same = others.filter((product) => product.category === current.category);
  const rest = others.filter((product) => product.category !== current.category);
  return [...same, ...rest].slice(0, limit);
}

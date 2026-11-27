// Which products a product page suggests. Pure: works on the summary's product list, so the server function that
// uses it reads no D1.
import type { ProductSummary } from "@/domain/catalog-snapshot";
import type { Category } from "@/lib/types";

/** The product page shows one row of four (`.pdp-grid`). */
export const RELATED_LIMIT = 4;

const isSoldOut = (product: { variants?: readonly { availability: string }[] }): boolean =>
  Boolean(product.variants && product.variants.length > 0 && product.variants.every((v) => v.availability === "out_of_stock"));

/**
 * Related product order (C2.6 / #4):
 * 1. Same subcategory (exact category id match)
 * 2. Same top-level category (siblings sharing the same root parent)
 * 3. Other categories
 * Within each group, sold-out products go last (in fact, all sold-out products go after available ones).
 * The list is rotated to start after the current product so neighbours vary across pages.
 */
export function selectRelated<
  T extends Pick<ProductSummary, "id" | "category"> & Partial<Pick<ProductSummary, "variants">>,
>(
  products: T[],
  current: Pick<ProductSummary, "id" | "category">,
  limit = RELATED_LIMIT,
  categories: readonly Pick<Category, "id" | "parentId">[] = [],
): T[] {
  const parentById = new Map(categories.map((cat) => [cat.id, cat.parentId ?? null]));
  const rootOf = (categoryId: string) => parentById.get(categoryId) ?? categoryId;
  const currentRoot = rootOf(current.category);

  const at = products.findIndex((product) => product.id === current.id);
  const rotated = at === -1 ? products : [...products.slice(at + 1), ...products.slice(0, at)];
  const others = rotated.filter((product) => product.id !== current.id);

  const rank = (product: T): number => {
    const soldOutPenalty = isSoldOut(product) ? 3 : 0;
    if (product.category === current.category) return soldOutPenalty + 0;
    if (rootOf(product.category) === currentRoot) return soldOutPenalty + 1;
    return soldOutPenalty + 2;
  };

  return others
    .map((product, index) => ({ product, rank: rank(product), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.product);
}

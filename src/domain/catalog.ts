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
  typeof value === "string" && value.length >= 1 && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

type CategoryRef = { id: string; slug?: string | undefined; parentId?: string | null | undefined };

/** A category's public URL name: its slug, or its id when it has none. */
export const categorySlug = (category: Pick<CategoryRef, "id" | "slug">) => category.slug || category.id;

/** Finds a category by current slug, falling back to id. */
export function findCategory<T extends CategoryRef>(categories: Iterable<T>, key: string): T | undefined {
  let byId: T | undefined;
  for (const category of categories) {
    if (categorySlug(category) === key) return category;
    if (!byId && category.id === key) byId = category;
  }
  return byId;
}

/** Finds a category by id only. Use it for keys that are ids (tiles, facets, breadcrumbs), never for URL segments. */
export function findCategoryById<T extends CategoryRef>(categories: Iterable<T>, id: string): T | undefined {
  for (const category of categories) if (category.id === id) return category;
  return undefined;
}

/**
 * Categories shown at the top level (`/collections` and home tiles): those with no parent, plus any category whose
 * parent is absent from `categories` (matching `collectionSegments`, which promotes orphans to `/collections/<slug>`).
 */
export function topLevelCategories<T extends CategoryRef>(categories: readonly T[]): T[] {
  const ids = new Set(categories.map((category) => category.id));
  return categories.filter((category) => !category.parentId || !ids.has(category.parentId));
}

/**
 * The path segments of a category's page: `{ category }` for a top-level one, `{ category, subcategory }` (the
 * parent's slug, then its own) for a subcategory. A subcategory whose parent is missing is served at the top level.
 */
export function collectionSegments<T extends CategoryRef>(
  category: T,
  categories: Iterable<T>,
): { category: string; subcategory?: string } {
  const parent = category.parentId ? findCategoryById(categories, category.parentId) : undefined;
  return parent
    ? { category: categorySlug(parent), subcategory: categorySlug(category) }
    : { category: categorySlug(category) };
}

/** `/collections/<slug>` or `/collections/<parent>/<slug>`, the one canonical path for a category. */
export function collectionPath<T extends CategoryRef>(category: T, categories: Iterable<T>): string {
  const segments = collectionSegments(category, categories);
  return `/collections/${encodeURIComponent(segments.category)}${
    segments.subcategory ? `/${encodeURIComponent(segments.subcategory)}` : ""
  }`;
}

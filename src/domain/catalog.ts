// Pure catalogue helpers. No React, no D1, no fetch: every function takes the catalogue it works on.
import type { Catalog, Category, Product, Variant } from "@/lib/types";

/** The catalogue plus lookup maps, built once per catalogue value. */
export interface CatalogIndex extends Catalog {
  categoryById: Map<string, Category>;
  productById: Map<number, Product>;
  productBySlug: Map<string, Product>;
  /** Display position (the D1 `sort` order), used by the "featured" sort. */
  productOrder: Map<number, number>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  return {
    ...catalog,
    categoryById: new Map(catalog.categories.map((category) => [category.id, category])),
    productById: new Map(catalog.products.map((product) => [product.id, product])),
    productBySlug: new Map(catalog.products.map((product) => [product.slug, product])),
    productOrder: new Map(catalog.products.map((product, index) => [product.id, index])),
  };
}

const priceFormatter = new Intl.NumberFormat("en-US");
export const formatPrice = (value: number) => `৳ ${priceFormatter.format(value)}`;

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function getVariant(product: Product, index = 0): Variant {
  return product.variants[index] ?? product.variants[0];
}

export function getCategory(catalog: CatalogIndex, product: Product): Category {
  const category = catalog.categoryById.get(product.category);
  if (!category) throw new Error(`Unknown category ${product.category}`);
  return category;
}

export function countInCategory(catalog: CatalogIndex, categoryId: string) {
  return catalog.products.filter((product) => product.category === categoryId).length;
}

/** Shape check for `?category=` before the catalogue is loaded; unknown ids fall back to "all" when rendering. */
export const isCategorySlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);

function searchableText(catalog: CatalogIndex, product: Product) {
  const category = catalog.categoryById.get(product.category)?.name ?? "";
  return [
    product.name,
    category,
    product.summary,
    ...(product.details ?? []),
    ...product.variants.map((variant) => variant.name),
  ]
    .join(" ")
    .toLowerCase();
}

export type SortKey = "featured" | "price-asc" | "price-desc" | "name";
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name", label: "Name: A–Z" },
];

export function filterProducts(
  catalog: CatalogIndex,
  { category, query, sort }: { category: string; query: string; sort: SortKey },
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const order = (product: Product) => catalog.productOrder.get(product.id) ?? 0;
  const sorters: Record<SortKey, (a: Product, b: Product) => number> = {
    featured: (a, b) => order(a) - order(b),
    "price-asc": (a, b) => a.price - b.price || a.name.localeCompare(b.name),
    "price-desc": (a, b) => b.price - a.price || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return catalog.products
    .filter((product) => {
      if (category !== "all" && product.category !== category) return false;
      const text = searchableText(catalog, product);
      return terms.every((term) => text.includes(term));
    })
    .sort(sorters[sort]);
}

export function relatedProducts(catalog: CatalogIndex, product: Product) {
  const same = catalog.products.filter((item) => item.id !== product.id && item.category === product.category);
  const others = catalog.products.filter((item) => item.id !== product.id && item.category !== product.category);
  return [...same, ...others].slice(0, 4);
}

import { CATEGORIES, PRODUCTS } from "./catalog-data";
import type { Category, Product, Variant } from "./types";

export { CATEGORIES, PRODUCTS };

export const categoryById = new Map<string, Category>(CATEGORIES.map((category) => [category.id, category]));
export const productById = new Map<number, Product>(PRODUCTS.map((product) => [product.id, product]));
export const productBySlug = new Map<string, Product>(PRODUCTS.map((product) => [product.slug, product]));
const productOrder = new Map<number, number>(PRODUCTS.map((product, index) => [product.id, index]));

const priceFormatter = new Intl.NumberFormat("en-US");
export const formatPrice = (value: number) => `৳ ${priceFormatter.format(value)}`;

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function getVariant(product: Product, index = 0): Variant {
  return product.variants[index] ?? product.variants[0];
}

export function getCategory(product: Product): Category {
  const category = categoryById.get(product.category);
  if (!category) throw new Error(`Unknown category ${product.category}`);
  return category;
}

export function countInCategory(categoryId: string) {
  return PRODUCTS.filter((product) => product.category === categoryId).length;
}

export function isCategoryId(value: unknown): value is Category["id"] {
  return typeof value === "string" && categoryById.has(value);
}

function searchableText(product: Product) {
  const category = categoryById.get(product.category)?.name ?? "";
  return [product.name, category, product.summary, ...(product.details ?? []), ...product.variants.map((variant) => variant.name)]
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

const sorters: Record<SortKey, (a: Product, b: Product) => number> = {
  featured: (a, b) => (productOrder.get(a.id) ?? 0) - (productOrder.get(b.id) ?? 0),
  "price-asc": (a, b) => a.price - b.price || a.name.localeCompare(b.name),
  "price-desc": (a, b) => b.price - a.price || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
};

export function filterProducts({ category, query, sort }: { category: string; query: string; sort: SortKey }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return PRODUCTS.filter((product) => {
    if (category !== "all" && product.category !== category) return false;
    const text = searchableText(product);
    return terms.every((term) => text.includes(term));
  }).sort(sorters[sort]);
}

export function relatedProducts(product: Product) {
  const same = PRODUCTS.filter((item) => item.id !== product.id && item.category === product.category);
  const others = PRODUCTS.filter((item) => item.id !== product.id && item.category !== product.category);
  return [...same, ...others].slice(0, 4);
}

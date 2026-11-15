// Filtering, sorting and paging for the product listing pages, plus the home page's row selections. Pure: works on the
// summary snapshot's product list, so the server function that uses it reads no D1.
import { comparePosition, type CatalogSummary, type ProductSummary } from "@/domain/catalog-snapshot";

/** Products per listing page (decision D2). */
export const LISTING_PAGE_SIZE = 24;
/** Cards in each home page row. */
export const HOME_ROW_SIZE = 8;

export const SORT_KEYS = ["featured", "newest", "price-asc", "price-desc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = "featured";
export const SORT_LABELS: Record<SortKey, string> = {
  featured: "Featured",
  newest: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

/** Without a value every product is listed, sold out ones included (they carry a tag on the card). */
export const AVAILABILITY_FILTERS = ["in-stock", "preorder"] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];
export const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  "in-stock": "In stock",
  preorder: "Pre-order",
};

export const MAX_SEARCH_LENGTH = 80;
export const MAX_PRICE = 10_000_000;
export const MAX_PAGE = 1000;

/** What a listing URL can carry besides the path. Defaults are left out so the clean URL stays clean. */
export interface ListSearch {
  q?: string;
  sort?: SortKey;
  min?: number;
  max?: number;
  availability?: AvailabilityFilter;
  page?: number;
}

/** A listing request. `category` comes from the path (`/collections/<category>`), the rest from `ListSearch`. */
export interface ListQuery extends ListSearch {
  category?: string;
}

export interface CategoryFacet {
  id: string;
  name: string;
  /** Products in this category that match every other filter. */
  count: number;
}

export interface ListFacets {
  /** Categories that hold at least one published product, in display order. */
  categories: CategoryFacet[];
  /** Cheapest and dearest price among products matching every filter but price; null when there are none. */
  price: { min: number; max: number } | null;
  /** Matches for each availability choice, ignoring the availability filter itself. */
  availability: { all: number; inStock: number; preorder: number };
}

export interface ListPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  facets: ListFacets;
}

const integerIn = (value: unknown, min: number, max: number): number | undefined => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
};

/** The search text the router parsed (a bare `?q=2` arrives as a number), trimmed, one space between words. */
export function cleanSearchText(value: unknown): string | undefined {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH).trim();
  return cleaned || undefined;
}

/** Keeps the listing params that are valid and not the default; drops the rest, so a bad link opens the plain page. */
export function parseListSearch(raw: Record<string, unknown>): ListSearch {
  const search: ListSearch = {};
  const q = cleanSearchText(raw.q);
  if (q) search.q = q;
  if (typeof raw.sort === "string" && raw.sort !== DEFAULT_SORT && (SORT_KEYS as readonly string[]).includes(raw.sort))
    search.sort = raw.sort as SortKey;
  const min = integerIn(raw.min, 0, MAX_PRICE);
  if (min !== undefined) search.min = min;
  const max = integerIn(raw.max, 0, MAX_PRICE);
  if (max !== undefined) search.max = max;
  if (typeof raw.availability === "string" && (AVAILABILITY_FILTERS as readonly string[]).includes(raw.availability))
    search.availability = raw.availability as AvailabilityFilter;
  const page = integerIn(raw.page, 2, MAX_PAGE);
  if (page !== undefined) search.page = page;
  return search;
}

/** True when the visitor narrowed the list (the page number and sort order do not narrow it). */
export const hasActiveFilters = (search: ListSearch) =>
  Boolean(search.q || search.min !== undefined || search.max !== undefined || search.availability);

/** `search` without paging, so two pages of one list share a key. */
export function withoutPage(search: ListSearch): ListSearch {
  const { page: _page, ...rest } = search;
  return rest;
}

/** The same query with every unset key removed: a stable cache key and a clean server-function input. */
export function normalizeQuery(query: ListQuery): ListQuery {
  const clean: ListQuery = {};
  if (query.category) clean.category = query.category;
  if (query.q) clean.q = query.q;
  if (query.sort && query.sort !== DEFAULT_SORT) clean.sort = query.sort;
  if (query.min !== undefined) clean.min = query.min;
  if (query.max !== undefined) clean.max = query.max;
  if (query.availability) clean.availability = query.availability;
  if (query.page && query.page > 1) clean.page = query.page;
  return clean;
}

const hasColour = (product: ProductSummary, availability: "in_stock" | "preorder") =>
  product.variants.some((variant) => variant.availability === availability);

const newestFirst = (a: ProductSummary, b: ProductSummary) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : comparePosition(a, b);

const SORTERS: Record<SortKey, (a: ProductSummary, b: ProductSummary) => number> = {
  // Featured products first, each group newest first (decision D7).
  featured: (a, b) => Number(b.featured) - Number(a.featured) || newestFirst(a, b),
  newest: newestFirst,
  "price-asc": (a, b) => a.price - b.price || comparePosition(a, b),
  "price-desc": (a, b) => b.price - a.price || comparePosition(a, b),
};

/**
 * Filters, sorts and pages the summary. Search (decision D5) matches every word against the product name and its
 * category name; the summary holds no longer text. Facets are counted over the products that match every other
 * filter, so the page can hide a filter that offers one choice.
 */
export function listProducts(summary: CatalogSummary, query: ListQuery): ListPage {
  const categoryNames = new Map(summary.categories.map((category) => [category.id, category.name]));
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const { min, max } = query;

  const categoryCounts = new Map<string, number>();
  const present = new Set<string>();
  const matches: ProductSummary[] = [];
  let priceLow = Infinity;
  let priceHigh = -Infinity;
  const availability = { all: 0, inStock: 0, preorder: 0 };

  for (const product of summary.products) {
    present.add(product.category);
    const text = `${product.name} ${categoryNames.get(product.category) ?? ""}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) continue;
    const inCategory = !query.category || product.category === query.category;
    const inPrice = (min === undefined || product.price >= min) && (max === undefined || product.price <= max);
    const stocked = hasColour(product, "in_stock");
    const preorder = hasColour(product, "preorder");
    const inAvailability = query.availability === undefined || (query.availability === "in-stock" ? stocked : preorder);

    if (inPrice && inAvailability)
      categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1);
    if (inCategory && inAvailability) {
      priceLow = Math.min(priceLow, product.price);
      priceHigh = Math.max(priceHigh, product.price);
    }
    if (inCategory && inPrice) {
      availability.all += 1;
      if (stocked) availability.inStock += 1;
      if (preorder) availability.preorder += 1;
    }
    if (inCategory && inPrice && inAvailability) matches.push(product);
  }

  matches.sort(SORTERS[query.sort ?? DEFAULT_SORT]);
  const pageCount = Math.max(1, Math.ceil(matches.length / LISTING_PAGE_SIZE));
  const page = Math.max(1, query.page ?? 1);
  const start = (page - 1) * LISTING_PAGE_SIZE;

  return {
    items: matches.slice(start, start + LISTING_PAGE_SIZE),
    total: matches.length,
    page,
    pageCount,
    pageSize: LISTING_PAGE_SIZE,
    facets: {
      categories: summary.categories
        .filter((category) => present.has(category.id))
        .map((category) => ({ id: category.id, name: category.name, count: categoryCounts.get(category.id) ?? 0 })),
      price: priceLow <= priceHigh ? { min: priceLow, max: priceHigh } : null,
      availability,
    },
  };
}

/** Featured products in display order (the summary is already in `sort` order), for the home page row. */
export const selectFeatured = (products: ProductSummary[], limit = HOME_ROW_SIZE) =>
  products.filter((product) => product.featured).slice(0, limit);

/** The most recently created products, for the home page row. */
export const selectNewest = (products: ProductSummary[], limit = HOME_ROW_SIZE) =>
  [...products].sort(newestFirst).slice(0, limit);

/** Whether a filter group offers a real choice: at least two options that give different results. */
export function offersChoice(counts: number[], total: number): boolean {
  return counts.some((count) => count > 0 && count < total);
}

// Public product lookups over the cached snapshots. Server-only. None of these touches D1 unless a snapshot is missing
// (see catalog-cache.server.ts), and none returns cost_price: it is not in any snapshot.
import { collectionPath, findCategory } from "@/domain/catalog";
import { type HomeSettings, resolveHomeSettings } from "@/domain/home-settings";
import type { DeliveryZone } from "@/domain/orders";
import { listProducts, type ListPage, type ListQuery, selectFeatured, selectNewest } from "@/domain/product-listing";
import { selectRelated } from "@/domain/related-products";
import {
  priceDetail,
  priceSummary,
  type ProductCard,
  type ProductSummary,
  type PublicProduct,
  resolveCard,
  resolveCategory,
  resolveProduct,
  summaryIndex,
} from "@/domain/catalog-snapshot";
import { HERO_SLIDES } from "@/lib/config";
import type { Category } from "@/lib/types";
import { type CatalogSources, getCatalogSummary, getProductDetail } from "@/server/catalog-cache.server";
import { getCachedHomeSettings } from "@/server/home-cache.server";

/**
 * The summary with the sales that are active now applied (price, struck price, badge), so every public read below
 * shows the charged price. Sales are checked against the clock here, not when the snapshot was written, so one starts
 * or ends without a rebuild (within a minute, and edge copies lag up to 5 minutes).
 */
async function getPricedSummary(sources: CatalogSources) {
  return priceSummary(await getCatalogSummary(sources));
}

/** Most ids one call looks up. A bag holds one line per product and colour, so 50 is far past a real bag. */
export const MAX_IDS_PER_LOOKUP = 50;

export interface ProductsByIds {
  /** Image origin for keys that components hard-code (see mediaUrl in src/domain/media.ts). */
  imageBase: string;
  /** Published products among the ids, in the order asked, each once. Images are URLs. */
  products: ProductCard[];
  /** Ids that are not published (archived, drafted, never existed). The bag shows them as unavailable. */
  missing: number[];
  /** Category names for the returned products, keyed by category id (cards show them). */
  categoryNames: Record<string, string>;
  /** Active delivery areas, so the bag footer and checkout need no second request. */
  zones: DeliveryZone[];
}

function namesFor(index: ReturnType<typeof summaryIndex>, cards: { category: string }[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const { category } of cards) {
    const found = index.categoryById.get(category);
    if (found) names[category] = found.name;
  }
  return names;
}

/** Cards for a bag, checkout or recently-viewed list. Reads the summary only. */
export async function getProductsByIds(sources: CatalogSources, ids: number[]): Promise<ProductsByIds> {
  const summary = await getPricedSummary(sources);
  const index = summaryIndex(summary);
  const products: ProductCard[] = [];
  const missing: number[] = [];
  for (const id of new Set(ids.slice(0, MAX_IDS_PER_LOOKUP))) {
    const product = index.byId.get(id);
    if (product) products.push(resolveCard(product, sources.imageBase));
    else missing.push(id);
  }
  return {
    imageBase: sources.imageBase,
    products,
    missing,
    categoryNames: namesFor(index, products),
    zones: summary.zones,
  };
}

export interface RelatedProducts {
  imageBase: string;
  products: ProductCard[];
  categoryNames: Record<string, string>;
}

/** Suggestions for a product page: same category first, from the summary (see selectRelated). Unknown slug: none. */
export async function getRelatedProducts(sources: CatalogSources, slug: string): Promise<RelatedProducts> {
  const summary = await getPricedSummary(sources);
  const index = summaryIndex(summary);
  const current = index.bySlug.get(slug);
  const products = (current ? selectRelated(summary.products, current, undefined, summary.categories) : []).map(
    (product) => resolveCard(product, sources.imageBase),
  );
  return { imageBase: sources.imageBase, products, categoryNames: namesFor(index, products) };
}

export interface ProductPageData {
  imageBase: string;
  product: PublicProduct | null;
  category: Category | null;
}

/** The product page's data: found by slug in the summary (no D1 for an unknown slug), then its detail snapshot. */
export async function getProductBySlug(sources: CatalogSources, slug: string): Promise<ProductPageData> {
  const summary = await getPricedSummary(sources);
  const index = summaryIndex(summary);
  const found = index.bySlug.get(slug);
  const detail = found ? await getProductDetail(sources, summary, found.id) : undefined;
  if (!detail) return { imageBase: sources.imageBase, product: null, category: null };
  const category = index.categoryById.get(detail.category);
  return {
    imageBase: sources.imageBase,
    product: resolveProduct(priceDetail(detail, found as ProductSummary), sources.imageBase),
    category: category ? resolveCategory(category, sources.imageBase, summary.categories) : null,
  };
}

export interface ProductListing extends Omit<ListPage, "items"> {
  imageBase: string;
  /** One page of cards, images as URLs. */
  products: ProductCard[];
  categoryNames: Record<string, string>;
  /** The category the query asked for; null when none was asked for or no such category exists. */
  category: Category | null;
  /**
   * The category page's one canonical path (`collectionPath`): current slugs, the parent's included. The route 301s any
   * other path that reached this category (an old slug, a moved subcategory, a renamed parent) to it.
   */
  canonicalPath?: string;
}

/** One page of the product listing: filtered, sorted and paged in memory over the summary. No D1. */
export async function listProductsPage(sources: CatalogSources, query: ListQuery): Promise<ProductListing> {
  const summary = await getPricedSummary(sources);
  const index = summaryIndex(summary);
  let resolvedCategory: Category | undefined;
  if (query.category) {
    resolvedCategory = findCategory(summary.categories, query.category);
    const renamedTo = resolvedCategory ? undefined : summary.categorySlugs?.[query.category];
    if (renamedTo) resolvedCategory = index.categoryById.get(renamedTo);
  }
  const effectiveQuery = resolvedCategory ? { ...query, category: resolvedCategory.id } : query;
  const { items, ...page } = listProducts(summary, effectiveQuery);
  const products = items.map((product) => resolveCard(product, sources.imageBase));
  return {
    ...page,
    imageBase: sources.imageBase,
    products,
    categoryNames: namesFor(index, products),
    category: resolvedCategory ? resolveCategory(resolvedCategory, sources.imageBase, summary.categories) : null,
    ...(resolvedCategory ? { canonicalPath: collectionPath(resolvedCategory, summary.categories) } : {}),
  };
}

export interface CategoriesData {
  imageBase: string;
  /** Every category with its image as a URL and the number of published products in it. */
  categories: (Category & { count: number })[];
}

/** What the header, footer and collection tiles need on every page. Summary only. */
export async function getCategories(sources: CatalogSources): Promise<CategoriesData> {
  const summary = await getPricedSummary(sources);
  const counts = new Map<string, number>();
  const byId = new Map(summary.categories.map((category) => [category.id, category]));
  // A parent's count includes its subcategories' products, the same set its page lists.
  for (const product of summary.products) {
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    const parent = byId.get(product.category)?.parentId;
    if (parent && parent !== product.category) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return {
    imageBase: sources.imageBase,
    categories: summary.categories.map((category) => ({
      ...resolveCategory(category, sources.imageBase, summary.categories),
      count: counts.get(category.id) ?? 0,
    })),
  };
}

export interface HomeData {
  imageBase: string;
  settings?: HomeSettings;
  categoryNames: Record<string, string>;
  featured: ProductCard[];
  newest: ProductCard[];
  /** The hero slides' products, in slide order (a product that is no longer published is left out). */
  hero: ProductCard[];
}

/** Everything the home page shows, straight from the cached summary. */
export async function getHome(sources: CatalogSources): Promise<HomeData> {
  const [summary, rawSettings] = await Promise.all([getPricedSummary(sources), getCachedHomeSettings(sources)]);
  const index = summaryIndex(summary);
  const card = (product: ProductSummary) => resolveCard(product, sources.imageBase);
  const hero = HERO_SLIDES.flatMap((slide) => {
    const product = index.byId.get(slide.id);
    return product ? [card(product)] : [];
  });
  const featured = selectFeatured(summary.products).map(card);
  const newest = selectNewest(summary.products).map(card);
  return {
    imageBase: sources.imageBase,
    settings: resolveHomeSettings(rawSettings, sources.imageBase),
    categoryNames: namesFor(index, [...featured, ...newest, ...hero]),
    featured,
    newest,
    hero,
  };
}

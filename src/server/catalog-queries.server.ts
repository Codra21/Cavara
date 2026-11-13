// Public product lookups over the cached snapshots. Server-only. None of these touches D1 unless a snapshot is missing
// (see catalog-cache.server.ts), and none returns cost_price: it is not in any snapshot.
import type { DeliveryZone } from "@/domain/orders";
import { selectRelated } from "@/domain/related-products";
import {
  type ProductCard,
  type PublicProduct,
  resolveCard,
  resolveCategory,
  resolveProduct,
  summaryIndex,
} from "@/domain/catalog-snapshot";
import type { Category } from "@/lib/types";
import { type CatalogSources, getCatalogSummary, getProductDetail } from "@/server/catalog-cache.server";

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
  const summary = await getCatalogSummary(sources);
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
  const summary = await getCatalogSummary(sources);
  const index = summaryIndex(summary);
  const current = index.bySlug.get(slug);
  const products = (current ? selectRelated(summary.products, current) : []).map((product) =>
    resolveCard(product, sources.imageBase),
  );
  return { imageBase: sources.imageBase, products, categoryNames: namesFor(index, products) };
}

export interface ProductPageData {
  imageBase: string;
  /** null when no published product has this slug. */
  product: PublicProduct | null;
  category: Category | null;
}

/** The product page's data: found by slug in the summary (no D1 for an unknown slug), then its detail snapshot. */
export async function getProductBySlug(sources: CatalogSources, slug: string): Promise<ProductPageData> {
  const summary = await getCatalogSummary(sources);
  const index = summaryIndex(summary);
  const found = index.bySlug.get(slug);
  const detail = found ? await getProductDetail(sources, summary, found.id) : undefined;
  if (!detail) return { imageBase: sources.imageBase, product: null, category: null };
  const category = index.categoryById.get(detail.category);
  return {
    imageBase: sources.imageBase,
    product: resolveProduct(detail, sources.imageBase),
    category: category ? resolveCategory(category, sources.imageBase) : null,
  };
}

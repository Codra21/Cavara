// Shapes and pure rules for the split catalogue snapshots (catalog v2). No React, no D1, no fetch.
//
// Three stored documents, all built from the same D1 rows (src/server/db/catalog.repository.ts):
// - summary: every published product in a few hundred bytes, plus categories and active delivery zones. Listing,
//   search, bag and checkout read this. Product rows are positional tuples (see StoredProduct) to keep the JSON small.
// - detail: one object per product with the long text and every picture of every colour. The product page reads it.
// - legacy: the full v1 `Catalog` that getCatalogFn still serves until the storefront moves to the other two.
//
// Snapshots hold R2 image keys, never URLs (code-standards: Images). Public function output turns keys into URLs with
// resolve*() below, so a changed IMAGE_BASE_URL never leaves wrong URLs in a stored object.
import { bestSale, type SaleRule, saleBadge, strikePrice } from "@/domain/discounts";
import { mediaUrl } from "@/domain/media";
import type { DeliveryZone } from "@/domain/orders";
import type { Availability, Catalog, Category, Product, Variant } from "@/lib/types";

/**
 * Version of the detail and legacy documents. Bump with the edge cache paths and object keys in
 * src/server/catalog-cache.server.ts when their stored shape changes.
 */
export const SNAPSHOT_VERSION = 2;

/** Version of the summary document alone: 3 added the sales list (P9.2). The detail shape did not change. */
export const SUMMARY_VERSION = 3;

const AVAILABILITY_CODES: readonly Availability[] = ["in_stock", "out_of_stock", "preorder"];

export interface SummaryVariant {
  name: string;
  /** Any CSS background value. */
  swatch: string;
  availability: Availability;
  /** First picture of this colour (an R2 key in a snapshot, a URL in function output); null when it has none. */
  image: string | null;
}

/** A variant's position is its index in `variants` (positions are 0..n-1 without gaps). */
export interface ProductSummary {
  id: number;
  slug: string;
  name: string;
  category: string;
  price: number;
  /** The struck-through price, when the product is on offer. */
  regularPrice: number | null;
  featured: boolean;
  /** `YYYY-MM-DD` (UTC) the product was created. */
  createdAt: string;
  /** The D1 `sort` value. Only used to keep the list in display order; never sent to the browser. */
  sort: number;
  /** Card pictures: the first one or two of the default colour. */
  images: string[];
  variants: SummaryVariant[];
  /**
   * Set by priceSummary() on products a sale applies to, never stored. `price` is then the charged price and
   * `regularPrice` the struck-through one; `sale.listPrice` is what the product costs without the sale.
   */
  sale?: ProductSale | null;
}

/** What the storefront needs to show a sale: the badge text. The struck price is `regularPrice`. */
export interface ProductSale {
  listPrice: number;
  badge: string;
}

export interface CatalogSummary {
  /** Time-ordered id of the full rebuild that produced this summary. Detail objects from an older build are stale. */
  gen: string;
  /** Image keys. */
  categories: Category[];
  zones: DeliveryZone[];
  /** Sales that are on or still to come (active, not yet ended when written). Dates are checked again at read time. */
  sales: SaleRule[];
  /** Display order: `sort`, then id. */
  products: ProductSummary[];
}

export interface DetailVariant {
  name: string;
  swatch: string;
  availability: Availability;
  images: string[];
}

export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  category: string;
  price: number;
  regularPrice: number | null;
  featured: boolean;
  createdAt: string;
  sort: number;
  summary: string;
  details: string[];
  note: string | null;
  /** At least one colour; a product without any is not public. */
  variants: [DetailVariant, ...DetailVariant[]];
}

export interface ProductDetailDoc {
  gen: string;
  product: ProductDetail;
}

/** What one full read of D1 yields. Everything else in this file is derived from it. */
export interface FullCatalog {
  categories: Category[];
  products: ProductDetail[];
  zones: DeliveryZone[];
  sales: SaleRule[];
}

let generationCount = 0;

/**
 * A time-ordered build id: ISO time, then a per-isolate counter, then a random tail. The counter keeps two builds in
 * the same millisecond in the order they were made (a random tail alone compares either way, which made an older
 * detail look current); the tail keeps builds from different isolates apart.
 */
export function newGeneration(now = new Date()): string {
  generationCount = (generationCount + 1) % 36 ** 6;
  return `${now.toISOString()}-${generationCount.toString(36).padStart(6, "0")}-${crypto.randomUUID().slice(0, 4)}`;
}

/** A detail written for generation `detailGen` is usable by a summary of generation `summaryGen` unless older. */
export const detailIsCurrent = (detailGen: string, summaryGen: string) => detailGen >= summaryGen;

export const comparePosition = (a: { sort: number; id: number }, b: { sort: number; id: number }) =>
  a.sort - b.sort || a.id - b.id;

// Projections

export function toProductSummary(product: ProductDetail): ProductSummary {
  const [first, ...rest] = product.variants;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    regularPrice: product.regularPrice,
    featured: product.featured,
    createdAt: product.createdAt,
    sort: product.sort,
    images: first.images.slice(0, 2),
    variants: [first, ...rest].map((variant) => ({
      name: variant.name,
      swatch: variant.swatch,
      availability: variant.availability,
      image: variant.images[0] ?? null,
    })),
  };
}

export function toLegacyProduct(product: ProductDetail, imageBase: string): Product {
  const [first, ...rest] = product.variants.map((variant): Variant => ({
    name: variant.name,
    swatch: variant.swatch,
    images: variant.images.map((key) => mediaUrl(imageBase, key)),
    availability: variant.availability,
  }));
  const legacy: Product = {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    summary: product.summary,
    variants: [first as Variant, ...rest],
  };
  if (product.details.length) legacy.details = product.details;
  if (product.note) legacy.note = product.note;
  return legacy;
}

export function toLegacyCatalog(full: FullCatalog, imageBase: string): Catalog {
  return {
    categories: full.categories.map((category) => ({ ...category, image: mediaUrl(imageBase, category.image) })),
    products: full.products.map((product) => toLegacyProduct(product, imageBase)),
    imageBase,
    deliveryZones: full.zones,
  };
}

export function toSummary(full: FullCatalog, gen: string): CatalogSummary {
  return {
    gen,
    categories: full.categories,
    zones: full.zones,
    sales: full.sales,
    products: full.products.map(toProductSummary),
  };
}

// Stored form

/**
 * Summary rows are tuples, about 40% smaller than objects with named keys:
 * [id, slug, name, category, price, regularPrice (0 = none), featured (0|1), createdAt, sort, card images,
 *  colours: [name, swatch, availability code, image (omitted for colour 0, which uses the first card image)][]].
 */
type StoredVariant = [string, string, number, string?];
type StoredProduct = [
  number,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  number,
  string[],
  StoredVariant[],
];

interface StoredSummary {
  v: number;
  gen: string;
  categories: Category[];
  zones: DeliveryZone[];
  sales: SaleRule[];
  products: StoredProduct[];
}

export function encodeSummary(summary: CatalogSummary): string {
  const products = summary.products.map((product): StoredProduct => {
    const variants = product.variants.map((variant, index): StoredVariant => {
      const code = AVAILABILITY_CODES.indexOf(variant.availability);
      return index === 0 || !variant.image
        ? [variant.name, variant.swatch, code]
        : [variant.name, variant.swatch, code, variant.image];
    });
    return [
      product.id,
      product.slug,
      product.name,
      product.category,
      product.price,
      product.regularPrice ?? 0,
      product.featured ? 1 : 0,
      product.createdAt,
      product.sort,
      product.images,
      variants,
    ];
  });
  const stored: StoredSummary = {
    v: SUMMARY_VERSION,
    gen: summary.gen,
    categories: summary.categories,
    zones: summary.zones,
    sales: summary.sales,
    products,
  };
  return JSON.stringify(stored);
}

function bad(what: string): never {
  throw new Error(`catalogue summary is malformed: ${what}`);
}

/** Throws on a malformed or other-version document; callers treat that as a miss and rebuild. */
export function decodeSummary(json: string): CatalogSummary {
  const stored = JSON.parse(json) as Partial<StoredSummary>;
  if (stored.v !== SUMMARY_VERSION) bad("version");
  if (typeof stored.gen !== "string" || !Array.isArray(stored.categories) || !Array.isArray(stored.zones))
    bad("header");
  if (!Array.isArray(stored.sales) || !stored.sales.every(isStoredSale)) bad("sales");
  if (!Array.isArray(stored.products)) bad("products");
  const products = stored.products.map((row): ProductSummary => {
    if (!Array.isArray(row) || row.length !== 11) bad("product row");
    const [id, slug, name, category, price, regular, featured, createdAt, sort, images, variants] = row;
    if (
      typeof id !== "number" ||
      typeof slug !== "string" ||
      typeof name !== "string" ||
      typeof category !== "string" ||
      typeof price !== "number" ||
      typeof createdAt !== "string" ||
      typeof sort !== "number" ||
      !Array.isArray(images) ||
      !Array.isArray(variants)
    )
      bad(`product ${String(id)}`);
    return {
      id,
      slug,
      name,
      category,
      price,
      regularPrice: regular > 0 ? regular : null,
      featured: featured === 1,
      createdAt,
      sort,
      images,
      variants: variants.map(([variantName, swatch, code, image], index): SummaryVariant => {
        const availability = AVAILABILITY_CODES[code];
        if (typeof variantName !== "string" || typeof swatch !== "string" || !availability)
          bad(`variant of product ${id}`);
        return { name: variantName, swatch, availability, image: index === 0 ? (images[0] ?? null) : (image ?? null) };
      }),
    };
  });
  return { gen: stored.gen, categories: stored.categories, zones: stored.zones, sales: stored.sales, products };
}

function isStoredSale(value: unknown): value is SaleRule {
  const sale = value as Partial<SaleRule> | null;
  return (
    typeof sale === "object" &&
    sale !== null &&
    typeof sale.id === "number" &&
    (sale.scope === "all" || sale.scope === "category" || sale.scope === "product") &&
    (sale.type === "percent" || sale.type === "amount") &&
    typeof sale.value === "number" &&
    typeof sale.startsAt === "string" &&
    (sale.endsAt === null || typeof sale.endsAt === "string")
  );
}

export const encodeDetail = (doc: ProductDetailDoc): string => JSON.stringify({ v: SNAPSHOT_VERSION, ...doc });

export function decodeDetail(json: string): ProductDetailDoc {
  const doc = JSON.parse(json) as Partial<ProductDetailDoc> & { v?: number };
  const product = doc.product;
  if (
    doc.v !== SNAPSHOT_VERSION ||
    typeof doc.gen !== "string" ||
    !product ||
    typeof product.id !== "number" ||
    typeof product.slug !== "string" ||
    !Array.isArray(product.variants) ||
    product.variants.length === 0
  )
    throw new Error("product detail is malformed");
  return { gen: doc.gen, product };
}

// In-place patches (pure; the R2 read-modify-write lives in src/server/catalog-cache.server.ts)

/** Replaces, inserts or (with null) removes one product, keeping `sort`, then id order. */
export function patchSummaryProduct(summary: CatalogSummary, id: number, next: ProductSummary | null): CatalogSummary {
  const products = summary.products.filter((product) => product.id !== id);
  if (next) {
    const at = products.findIndex((product) => comparePosition(product, next) > 0);
    products.splice(at === -1 ? products.length : at, 0, next);
  }
  return { ...summary, products };
}

export const patchSummaryZones = (summary: CatalogSummary, zones: DeliveryZone[]): CatalogSummary => ({
  ...summary,
  zones,
});

export const patchSummarySales = (summary: CatalogSummary, sales: SaleRule[]): CatalogSummary => ({
  ...summary,
  sales,
});

/** The product listed just before `id` in display order, or null when it is first (or absent). */
export function predecessorId(summary: CatalogSummary, id: number): number | null {
  const index = summary.products.findIndex((product) => product.id === id);
  return index > 0 ? (summary.products[index - 1]?.id ?? null) : null;
}

/**
 * Same patch for the legacy catalogue, which has no `sort`: the product goes right after the one that precedes it in
 * the (already patched) summary. Returns undefined when that neighbour is missing from the legacy list, meaning the
 * two lists disagree; the caller then drops the legacy snapshot so it rebuilds from D1.
 */
export function patchLegacyProduct(
  catalog: Catalog,
  id: number,
  next: Product | null,
  afterId: number | null,
): Catalog | undefined {
  const products = catalog.products.filter((product) => product.id !== id);
  if (next) {
    let at = 0;
    if (afterId !== null) {
      const index = products.findIndex((product) => product.id === afterId);
      if (index === -1) return undefined;
      at = index + 1;
    }
    products.splice(at, 0, next);
  }
  return { ...catalog, products };
}

export const patchLegacyZones = (catalog: Catalog, zones: DeliveryZone[]): Catalog => ({
  ...catalog,
  deliveryZones: zones,
});

// Lookups

export interface SummaryIndex {
  byId: Map<number, ProductSummary>;
  bySlug: Map<string, ProductSummary>;
  categoryById: Map<string, Category>;
}

const indexes = new WeakMap<CatalogSummary, SummaryIndex>();

/** Lookup maps for a summary, built once per summary value. */
export function summaryIndex(summary: CatalogSummary): SummaryIndex {
  let index = indexes.get(summary);
  if (!index) {
    index = {
      byId: new Map(summary.products.map((product) => [product.id, product])),
      bySlug: new Map(summary.products.map((product) => [product.slug, product])),
      categoryById: new Map(summary.categories.map((category) => [category.id, category])),
    };
    indexes.set(summary, index);
  }
  return index;
}

// Sale prices

/** One product with the best active sale applied (see src/domain/discounts.ts), or unchanged when none applies. */
export function priceProduct(product: ProductSummary, sales: readonly SaleRule[], nowMs: number): ProductSummary {
  const best = bestSale(sales, product, product.price, nowMs);
  if (!best) return product;
  const strike = strikePrice(product.price, product.regularPrice);
  return {
    ...product,
    price: best.price,
    regularPrice: strike,
    sale: { listPrice: product.price, badge: saleBadge(strike, best.price) },
  };
}

const pricedSummaries = new WeakMap<CatalogSummary, { minute: number; value: CatalogSummary }>();

/**
 * The summary with sale prices applied at `nowMs`, so the listing's price sort and price filter, the cards and the
 * detail all see the charged price. Cached per summary value and minute, so a sale starts or ends within a minute of
 * its date without a rebuild, and the lookup maps are not rebuilt on every request. A summary with no sales comes
 * back as the same object.
 */
export function priceSummary(summary: CatalogSummary, nowMs = Date.now()): CatalogSummary {
  if (summary.sales.length === 0) return summary;
  const minute = Math.floor(nowMs / 60_000);
  const hit = pricedSummaries.get(summary);
  if (hit && hit.minute === minute) return hit.value;
  const value: CatalogSummary = {
    ...summary,
    products: summary.products.map((product) => priceProduct(product, summary.sales, minute * 60_000)),
  };
  pricedSummaries.set(summary, { minute, value });
  return value;
}

/** A product's detail priced like its summary entry (the detail snapshot holds the list price only). */
export function priceDetail(
  detail: ProductDetail,
  pricedEntry: ProductSummary,
): ProductDetail & { sale?: ProductSale } {
  return pricedEntry.sale
    ? { ...detail, price: pricedEntry.price, regularPrice: pricedEntry.regularPrice, sale: pricedEntry.sale }
    : detail;
}

// Public shapes: what the server functions return. Image keys are already URLs; `sort` and any cost data are gone.

export type ProductCard = Omit<ProductSummary, "sort">;

export type PublicProduct = Omit<ProductDetail, "sort"> & { sale?: ProductSale | null };

const NO_COLOUR: SummaryVariant = { name: "", swatch: "", availability: "in_stock", image: null };

/** The colour at `index` of a card, or its first colour when the index is out of range. */
export const cardVariant = (card: Pick<ProductCard, "variants">, index = 0): SummaryVariant =>
  card.variants[index] ?? card.variants[0] ?? NO_COLOUR;

/** The picture a card shows for a colour: that colour's own, else the card's first. */
export const cardImage = (card: Pick<ProductCard, "images" | "variants">, index = 0): string | undefined =>
  cardVariant(card, index).image ?? card.images[0];

export function resolveCard(product: ProductSummary, imageBase: string): ProductCard {
  const { sort: _sort, ...rest } = product;
  return {
    ...rest,
    images: product.images.map((key) => mediaUrl(imageBase, key)),
    variants: product.variants.map((variant) => ({
      ...variant,
      image: variant.image ? mediaUrl(imageBase, variant.image) : null,
    })),
  };
}

export function resolveProduct(
  product: ProductDetail & { sale?: ProductSale | null },
  imageBase: string,
): PublicProduct {
  const { sort: _sort, ...rest } = product;
  const [first, ...others] = product.variants.map((variant) => ({
    ...variant,
    images: variant.images.map((key) => mediaUrl(imageBase, key)),
  }));
  return { ...rest, variants: [first as DetailVariant, ...others] };
}

export const resolveCategory = (category: Category, imageBase: string): Category => ({
  ...category,
  image: mediaUrl(imageBase, category.image),
});

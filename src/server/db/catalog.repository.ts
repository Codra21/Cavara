// Catalogue reads from D1. Server-only. Public reads return published products only and never cost_price.
//
// Two ways in, both over the same row builder:
// - readPublishedCatalog: everything published. Used by the full rebuild (a cache miss, a migration, a failed patch).
// - readSnapshotProduct / readActiveZones: one product's rows, or the zones. Used by a save to patch the snapshots in
//   place. Their cost does not depend on how many products the shop has.
// D1 bills rows read, index entries included; every query here starts from an index (see catalog-refresh.test.ts,
// which checks the plans). Request paths never call this file: they go through src/server/catalog-cache.server.ts.
import { capVariantStock, type FullCatalog, type ProductDetail, toLegacyCatalog } from "@/domain/catalog-snapshot";
import type { SaleRule } from "@/domain/discounts";
import type { DeliveryZone } from "@/domain/orders";
import type { Availability, Catalog, Category } from "@/lib/types";
import type { D1Database, D1PreparedStatement } from "./d1";

interface CategoryRow {
  id: string;
  name: string;
  description: string;
  image: string;
  sort: number;
  parent_id: string | null;
  slug: string | null;
}

interface CategorySlugRow {
  old_slug: string;
  category_id: string;
}

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  category_id: string;
  summary: string;
  details: string;
  note: string | null;
  price: number;
  regular_price: number | null;
  featured: number;
  new_arrival: number;
  weight_g: number | null;
  created_at: string;
  sort: number;
}

/** One row per image; a variant without images comes back once with null image columns (LEFT JOIN). */
interface VariantImageRow {
  id: number;
  product_id: number;
  position: number;
  name: string;
  swatch: string;
  availability: Availability;
  stock: number | null;
  image_position: number | null;
  path: string | null;
}

const PRODUCT_COLUMNS =
  "p.id, p.slug, p.name, p.category_id, p.summary, p.details, p.note, p.price, p.regular_price, p.featured, p.new_arrival, p.weight_g, p.created_at, p.sort";

function parseDetails(raw: string, productId: number): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  } catch {
    // fall through
  }
  throw new Error(`products.details for product ${productId} is not a JSON array of strings`);
}

/**
 * Joins product rows to their colour and picture rows. A product without any colour is left out: it cannot be shown or
 * bagged, so skipping it beats breaking the page. Corrupt `details` JSON throws.
 */
function buildProducts(productRows: ProductRow[], variantRows: VariantImageRow[]): ProductDetail[] {
  const rows = [...variantRows].sort(
    (a, b) =>
      a.product_id - b.product_id || a.position - b.position || (a.image_position ?? -1) - (b.image_position ?? -1),
  );

  const variantsByProduct = new Map<number, ProductDetail["variants"][number][]>();
  let current: { id: number; images: string[] } | undefined;
  for (const row of rows) {
    if (row.id !== current?.id) {
      const list = variantsByProduct.get(row.product_id) ?? [];
      // position is the variant index saved in bags; positions must be 0..n-1 without gaps.
      if (row.position !== list.length)
        throw new Error(`product ${row.product_id} has a gap at variant position ${list.length}`);
      current = { id: row.id, images: [] };
      list.push({
        name: row.name,
        swatch: row.swatch,
        availability: row.availability,
        stock: capVariantStock(row.stock),
        images: current.images,
      });
      variantsByProduct.set(row.product_id, list);
    }
    if (row.path !== null) current.images.push(row.path);
  }

  return productRows.flatMap((row): ProductDetail[] => {
    const [first, ...rest] = variantsByProduct.get(row.id) ?? [];
    if (!first) return [];
    return [
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        category: row.category_id,
        price: row.price,
        regularPrice: row.regular_price,
        featured: row.featured === 1,
        newArrival: row.new_arrival === 1,
        weightG: row.weight_g,
        // The date part of an ISO timestamp (UTC); the summary has no use for the time.
        createdAt: row.created_at.slice(0, 10),
        sort: row.sort,
        summary: row.summary,
        details: parseDetails(row.details, row.id),
        note: row.note || null,
        variants: [first, ...rest],
      },
    ];
  });
}

// A handful of rows; sorted here (by id) so the stored list is stable and the query needs no temp B-tree.
const sortSales = (rows: SaleRule[]): SaleRule[] => [...rows].sort((a, b) => a.id - b.id);

function zonesFrom(rows: (DeliveryZone & { sort: number })[]): DeliveryZone[] {
  // A handful of rows; sorted here so the query needs no index or temp B-tree.
  return [...rows]
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map(({ id, name, charge, perKgCharge }) => ({ id, name, charge, perKgCharge: perKgCharge ?? 20 }));
}

export const ZONES_SQL =
  "SELECT id, name, charge, per_kg_charge AS perKgCharge, sort FROM delivery_zones WHERE active = 1";

/** Variants and pictures of the published products: starts at idx_products_status_sort, then the two UNIQUE indexes. */
export const ALL_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, v.stock, i.position AS image_position, i.path
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN product_images i ON i.variant_id = v.id
       WHERE p.status = 'published'`;

export const ALL_PRODUCTS_SQL = `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.status = 'published' ORDER BY p.sort, p.id`;

/** Primary-key lookup, so a save reads one product row whatever the catalogue size. */
export const ONE_PRODUCT_SQL = `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ? AND p.status = 'published'`;

/** UNIQUE (product_id, position), then UNIQUE (variant_id, position): the rows of one product only. */
export const ONE_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, v.stock, i.position AS image_position, i.path
       FROM product_variants v
       LEFT JOIN product_images i ON i.variant_id = v.id
       WHERE v.product_id = ?`;

// A handful of rows, sorted below so the query needs no temp B-tree.
export const CATEGORIES_SQL =
  "SELECT id, name, description, image, sort, parent_id, slug FROM categories WHERE active = 1";
export const CATEGORY_SLUGS_SQL = "SELECT old_slug, category_id FROM category_slugs";

const SALE_COLUMNS = `id, scope, category_id AS categoryId, product_id AS productId, type, value, starts_at AS startsAt,
    ends_at AS endsAt`;

/**
 * Sales that are on or still to come: active, and open-ended or ending after `now` (bind `now` once). Two probes on
 * idx_discounts_live (migration 0011), one for `ends_at > ?` and one for NULL, so sales that already ended are never
 * read. It is a UNION ALL because SQLite will not split `ends_at IS NULL OR ends_at > ?` into two probes and scans the
 * index instead. The WHERE text must match the partial index. Checkout reads the same rows and the dates are checked
 * again by the pure rule.
 */
export const LIVE_SALES_SQL = `SELECT ${SALE_COLUMNS} FROM discounts WHERE kind = 'sale' AND active = 1 AND ends_at > ?1
  UNION ALL
  SELECT ${SALE_COLUMNS} FROM discounts WHERE kind = 'sale' AND active = 1 AND ends_at IS NULL`;

export async function readLiveSales(db: D1Database, now: Date): Promise<SaleRule[]> {
  const at = now.toISOString();
  const { results } = await db.prepare(LIVE_SALES_SQL).bind(at).all<SaleRule>();
  return sortSales(results);
}

/**
 * The published catalogue in display order, with image keys left as keys. One batch = one round trip and a consistent
 * snapshot.
 */
export async function readPublishedCatalog(db: D1Database, now = new Date()): Promise<FullCatalog> {
  const [categoryResult, productResult, variantResult, zoneResult, saleResult, slugResult] = await db.batch([
    db.prepare(CATEGORIES_SQL),
    db.prepare(ALL_PRODUCTS_SQL),
    db.prepare(ALL_VARIANTS_SQL),
    db.prepare(ZONES_SQL),
    db.prepare(LIVE_SALES_SQL).bind(now.toISOString()),
    db.prepare(CATEGORY_SLUGS_SQL),
  ]);
  const activeCategories = ((categoryResult?.results ?? []) as CategoryRow[]).sort(
    (a, b) => a.sort - b.sort || a.id.localeCompare(b.id),
  );
  const activeCategoryIds = new Set(activeCategories.map((row) => row.id));
  const categories: Category[] = activeCategories.map(({ id, name, description, image, parent_id, slug }) => ({
    id,
    name,
    description,
    image,
    parentId: parent_id && activeCategoryIds.has(parent_id) ? parent_id : null,
    slug: slug || id,
  }));
  const categorySlugs: Record<string, string> = {};
  for (const row of (slugResult?.results ?? []) as CategorySlugRow[]) {
    categorySlugs[row.old_slug] = row.category_id;
  }
  return {
    categories,
    products: buildProducts(
      (productResult?.results ?? []) as ProductRow[],
      (variantResult?.results ?? []) as VariantImageRow[],
    ),
    zones: zonesFrom((zoneResult?.results ?? []) as (DeliveryZone & { sort: number })[]),
    sales: sortSales((saleResult?.results ?? []) as SaleRule[]),
    categorySlugs,
  };
}

/**
 * The legacy v1 catalogue (resolved image URLs, every product with details). Kept for getCatalogFn until the
 * storefront reads the summary and detail snapshots instead.
 */
export async function getPublishedCatalog(db: D1Database, imageBase = ""): Promise<Catalog> {
  return toLegacyCatalog(await readPublishedCatalog(db), imageBase);
}

/** One product as the public sees it, or null when it is not published or has no colour. Two statements, one batch. */
export async function readSnapshotProduct(db: D1Database, id: number): Promise<ProductDetail | null> {
  const statements: D1PreparedStatement[] = [
    db.prepare(ONE_PRODUCT_SQL).bind(id),
    db.prepare(ONE_VARIANTS_SQL).bind(id),
  ];
  const [productResult, variantResult] = await db.batch(statements);
  return (
    buildProducts(
      (productResult?.results ?? []) as ProductRow[],
      (variantResult?.results ?? []) as VariantImageRow[],
    )[0] ?? null
  );
}

/**
 * Several products' rows for one bulk action: primary-key lookups through json_each (one bound parameter), then the
 * UNIQUE indexes, so the cost follows the products listed, never the catalogue.
 */
export const MANY_PRODUCTS_SQL = `SELECT ${PRODUCT_COLUMNS} FROM json_each(?) j JOIN products p ON p.id = j.value WHERE p.status = 'published'`;

export const MANY_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, v.stock, i.position AS image_position, i.path
       FROM json_each(?) j
       JOIN products p ON p.id = j.value AND p.status = 'published'
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN product_images i ON i.variant_id = v.id`;

/** The published ones among `ids`, as the public sees them (see readSnapshotProduct). Two statements, one batch. */
export async function readSnapshotProducts(db: D1Database, ids: number[]): Promise<ProductDetail[]> {
  if (ids.length === 0) return [];
  const list = JSON.stringify(ids);
  const [productResult, variantResult] = await db.batch([
    db.prepare(MANY_PRODUCTS_SQL).bind(list),
    db.prepare(MANY_VARIANTS_SQL).bind(list),
  ]);
  return buildProducts(
    (productResult?.results ?? []) as ProductRow[],
    (variantResult?.results ?? []) as VariantImageRow[],
  );
}

export async function readActiveZones(db: D1Database): Promise<DeliveryZone[]> {
  const { results } = await db.prepare(ZONES_SQL).all<DeliveryZone & { sort: number }>();
  return zonesFrom(results);
}

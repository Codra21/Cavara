// Catalogue reads from D1. Server-only. Public reads return published products only and never cost_price.
//
// Two ways in, both over the same row builder:
// - readPublishedCatalog: everything published. Used by the full rebuild (a cache miss, a migration, a failed patch).
// - readSnapshotProduct / readActiveZones: one product's rows, or the zones. Used by a save to patch the snapshots in
//   place. Their cost does not depend on how many products the shop has.
// D1 bills rows read, index entries included; every query here starts from an index (see catalog-snapshot.test.ts,
// which checks the plans). Request paths never call this file: they go through src/server/catalog-cache.server.ts.
import { type FullCatalog, type ProductDetail, toLegacyCatalog } from "@/domain/catalog-snapshot";
import type { DeliveryZone } from "@/domain/orders";
import type { Availability, Catalog, Category } from "@/lib/types";
import type { D1Database, D1PreparedStatement } from "./d1";

interface CategoryRow {
  id: string;
  name: string;
  description: string;
  image: string;
  sort: number;
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
  image_position: number | null;
  path: string | null;
}

const PRODUCT_COLUMNS =
  "p.id, p.slug, p.name, p.category_id, p.summary, p.details, p.note, p.price, p.regular_price, p.featured, p.created_at, p.sort";

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
      list.push({ name: row.name, swatch: row.swatch, availability: row.availability, images: current.images });
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

function zonesFrom(rows: (DeliveryZone & { sort: number })[]): DeliveryZone[] {
  // A handful of rows; sorted here so the query needs no index or temp B-tree.
  return [...rows]
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map(({ id, name, charge }) => ({ id, name, charge }));
}

export const ZONES_SQL = "SELECT id, name, charge, sort FROM delivery_zones WHERE active = 1";

/** Variants and pictures of the published products: starts at idx_products_status_sort, then the two UNIQUE indexes. */
export const ALL_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, i.position AS image_position, i.path
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN product_images i ON i.variant_id = v.id
       WHERE p.status = 'published'`;

export const ALL_PRODUCTS_SQL = `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.status = 'published' ORDER BY p.sort, p.id`;

/** Primary-key lookup, so a save reads one product row whatever the catalogue size. */
export const ONE_PRODUCT_SQL = `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ? AND p.status = 'published'`;

/** UNIQUE (product_id, position), then UNIQUE (variant_id, position): the rows of one product only. */
export const ONE_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, i.position AS image_position, i.path
       FROM product_variants v
       LEFT JOIN product_images i ON i.variant_id = v.id
       WHERE v.product_id = ?`;

// A handful of rows, sorted below so the query needs no temp B-tree.
export const CATEGORIES_SQL = "SELECT id, name, description, image, sort FROM categories";

/**
 * The published catalogue in display order, with image keys left as keys. One batch = one round trip and a consistent
 * snapshot.
 */
export async function readPublishedCatalog(db: D1Database): Promise<FullCatalog> {
  const [categoryResult, productResult, variantResult, zoneResult] = await db.batch([
    db.prepare(CATEGORIES_SQL),
    db.prepare(ALL_PRODUCTS_SQL),
    db.prepare(ALL_VARIANTS_SQL),
    db.prepare(ZONES_SQL),
  ]);
  const categories: Category[] = ((categoryResult?.results ?? []) as CategoryRow[])
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map(({ id, name, description, image }) => ({ id, name, description, image }));
  return {
    categories,
    products: buildProducts(
      (productResult?.results ?? []) as ProductRow[],
      (variantResult?.results ?? []) as VariantImageRow[],
    ),
    zones: zonesFrom((zoneResult?.results ?? []) as (DeliveryZone & { sort: number })[]),
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

export const MANY_VARIANTS_SQL = `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, i.position AS image_position, i.path
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

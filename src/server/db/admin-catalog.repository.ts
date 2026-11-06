// Owner-only catalogue reads and writes. Server-only; callers must have passed ownerAuthMiddleware.
// A save is one D1 batch (one transaction). The first statement claims the product by swapping its revision; every
// later statement is guarded on the new revision, so a stale or concurrent save changes nothing at all.
import type { AdminIdentity, AuditValue } from "@/domain/admin";
import type {
  AdminCategory,
  AdminProduct,
  AdminProductSummary,
  AdminVariant,
  ProductInput,
  ProductStatus,
  SaveProductResult,
} from "@/domain/product-admin";
import type { Availability } from "@/lib/types";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

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
  cost_price: number | null;
  status: ProductStatus;
  featured: number;
  sort: number;
  revision: string;
  updated_at: string;
}

interface SummaryRow {
  id: number;
  slug: string;
  name: string;
  category_id: string;
  price: number;
  cost_price: number | null;
  status: ProductStatus;
  featured: number;
  sort: number;
  updated_at: string;
  variant_count: number;
  thumbnail: string | null;
}

interface VariantRow {
  id: number;
  name: string;
  swatch: string;
  availability: Availability;
}

interface ImageRow {
  variant_id: number;
  path: string;
}

/** Positions are moved out of the way before renumbering so UNIQUE (product_id, position) never trips mid-batch. */
const POSITION_PARK = 1000;

function parseDetails(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  } catch {
    // An unreadable value shows as no details; saving rewrites it as valid JSON.
  }
  return [];
}

export async function listAdminCategories(db: D1Database): Promise<AdminCategory[]> {
  const { results } = await db.prepare("SELECT id, name FROM categories ORDER BY sort, id").all<AdminCategory>();
  return results;
}

/** Every product, archived included, with its first picture for the list. */
export async function listAdminProducts(db: D1Database): Promise<AdminProductSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.category_id, p.price, p.cost_price, p.status, p.featured, p.sort, p.updated_at,
         (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
         (SELECT i.path FROM product_variants v JOIN product_images i ON i.variant_id = v.id
           WHERE v.product_id = p.id ORDER BY v.position, i.position LIMIT 1) AS thumbnail
       FROM products p
       ORDER BY CASE p.status WHEN 'archived' THEN 1 ELSE 0 END, p.sort, p.id`,
    )
    .all<SummaryRow>();
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryId: row.category_id,
    price: row.price,
    costPrice: row.cost_price,
    status: row.status,
    featured: row.featured === 1,
    sort: row.sort,
    variantCount: row.variant_count,
    thumbnail: row.thumbnail,
    updatedAt: row.updated_at,
  }));
}

export async function getAdminProduct(db: D1Database, id: number): Promise<AdminProduct | null> {
  const [productResult, variantResult, imageResult] = await db.batch([
    db
      .prepare(
        `SELECT id, slug, name, category_id, summary, details, note, price, regular_price, cost_price, status, featured,
           sort, revision, updated_at FROM products WHERE id = ?`,
      )
      .bind(id),
    db
      .prepare("SELECT id, name, swatch, availability FROM product_variants WHERE product_id = ? ORDER BY position")
      .bind(id),
    db
      .prepare(
        `SELECT i.variant_id, i.path FROM product_images i JOIN product_variants v ON v.id = i.variant_id
         WHERE v.product_id = ? ORDER BY v.position, i.position`,
      )
      .bind(id),
  ]);
  const row = (productResult?.results ?? [])[0] as ProductRow | undefined;
  if (!row) return null;

  const imagesByVariant = new Map<number, string[]>();
  for (const image of (imageResult?.results ?? []) as ImageRow[]) {
    const list = imagesByVariant.get(image.variant_id) ?? [];
    list.push(image.path);
    imagesByVariant.set(image.variant_id, list);
  }
  const variants: AdminVariant[] = ((variantResult?.results ?? []) as VariantRow[]).map((variant) => ({
    ...variant,
    images: imagesByVariant.get(variant.id) ?? [],
  }));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryId: row.category_id,
    summary: row.summary,
    details: parseDetails(row.details),
    note: row.note,
    price: row.price,
    regularPrice: row.regular_price,
    costPrice: row.cost_price,
    status: row.status,
    featured: row.featured === 1,
    sort: row.sort,
    revision: row.revision,
    updatedAt: row.updated_at,
    variants,
  };
}

function constraintError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed: products\.slug/i.test(message)) return "Another product already uses this URL name.";
  if (/UNIQUE constraint failed: products\.id/i.test(message)) return "Another product was created at the same moment. Save again.";
  if (/FOREIGN KEY constraint failed/i.test(message)) return "That category no longer exists. Reload and pick another.";
  return null;
}

export interface SaveProductOptions {
  actor: AdminIdentity;
  /** null creates a product. */
  id: number | null;
  /** Revision the editor loaded (ignored on create). */
  revision: string;
  input: ProductInput;
  now?: Date;
}

export async function saveProduct(db: D1Database, options: SaveProductOptions): Promise<SaveProductResult> {
  const { actor, input } = options;
  const now = (options.now ?? new Date()).toISOString();
  const nextRevision = crypto.randomUUID();
  const creating = options.id === null;

  // Reads before the batch: these only shape the statements. The revision guard makes them safe, because any
  // change that slips in between also changes the revision, and then the whole batch writes nothing.
  const [categoryResult, existingResult, maxResult] = await db.batch<{ id: number | string }>([
    db.prepare("SELECT id FROM categories WHERE id = ?").bind(input.categoryId),
    db.prepare("SELECT id FROM product_variants WHERE product_id = ?").bind(options.id ?? -1),
    db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM products"),
  ]);
  if (!categoryResult?.results.length) return { ok: false, error: "That category no longer exists. Reload and pick another." };

  const id = creating ? Number(maxResult?.results[0]?.id ?? 1) : (options.id as number);
  const existingIds = new Set((existingResult?.results ?? []).map((row) => Number(row.id)));
  const keptIds = input.variants.flatMap((variant) => (variant.id === null ? [] : [variant.id]));
  if (keptIds.some((variantId) => !existingIds.has(variantId))) {
    return { ok: false, conflict: true, error: "Some colours changed in another tab. Reload to see the latest version." };
  }

  const guardSql = "EXISTS (SELECT 1 FROM products WHERE id = ? AND revision = ?)";
  const guardParams = [id, nextRevision];
  const fields = [
    input.slug,
    input.name,
    input.categoryId,
    input.summary,
    JSON.stringify(input.details),
    input.note,
    input.price,
    input.regularPrice,
    input.costPrice,
    input.status,
    input.featured ? 1 : 0,
    input.sort,
  ];

  const statements: D1PreparedStatement[] = [];
  if (creating) {
    statements.push(
      db
        .prepare(
          `INSERT INTO products (id, slug, name, category_id, summary, details, note, price, regular_price, cost_price,
             status, featured, sort, archived_at, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'archived' THEN ? END, ?, ?, ?)`,
        )
        .bind(id, ...fields, input.status, now, nextRevision, now, now),
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE products SET slug = ?, name = ?, category_id = ?, summary = ?, details = ?, note = ?, price = ?,
             regular_price = ?, cost_price = ?, status = ?, featured = ?, sort = ?,
             archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) END,
             revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .bind(...fields, input.status, now, nextRevision, now, id, options.revision),
      db
        .prepare(
          `DELETE FROM product_images WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)
             AND ${guardSql}`,
        )
        .bind(id, ...guardParams),
      db
        .prepare(
          `DELETE FROM product_variants WHERE product_id = ? AND id NOT IN (SELECT value FROM json_each(?))
             AND ${guardSql}`,
        )
        .bind(id, JSON.stringify(keptIds), ...guardParams),
      db
        .prepare(`UPDATE product_variants SET position = position + ${POSITION_PARK} WHERE product_id = ? AND ${guardSql}`)
        .bind(id, ...guardParams),
    );
  }

  input.variants.forEach((variant, position) => {
    if (variant.id === null) {
      statements.push(
        db
          .prepare(
            `INSERT INTO product_variants (product_id, position, name, swatch, availability)
             SELECT ?, ?, ?, ?, ? WHERE ${guardSql}`,
          )
          .bind(id, position, variant.name, variant.swatch, variant.availability, ...guardParams),
      );
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE product_variants SET position = ?, name = ?, swatch = ?, availability = ?
             WHERE id = ? AND product_id = ? AND ${guardSql}`,
          )
          .bind(position, variant.name, variant.swatch, variant.availability, variant.id, id, ...guardParams),
      );
    }
  });

  // All pictures in one statement: a JSON list of { v: variant position, p: picture position, path }.
  const images = input.variants.flatMap((variant, v) => variant.images.map((path, p) => ({ v, p, path })));
  if (images.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_images (variant_id, position, path)
           SELECT pv.id, json_extract(j.value, '$.p'), json_extract(j.value, '$.path')
           FROM json_each(?) j JOIN product_variants pv
             ON pv.product_id = ? AND pv.position = json_extract(j.value, '$.v')
           WHERE ${guardSql}`,
        )
        .bind(JSON.stringify(images), id, ...guardParams),
    );
  }

  const details: Record<string, AuditValue> = {
    name: input.name,
    status: input.status,
    price: input.price,
    costPrice: input.costPrice,
    colours: input.variants.length,
  };
  statements.push(
    auditStatement(db, actor, creating ? "product.created" : "product.updated", String(id), details, new Date(now), {
      sql: guardSql,
      params: guardParams,
    }),
  );

  try {
    const [claim] = await db.batch(statements);
    if (claim?.meta.changes !== 1) {
      return {
        ok: false,
        conflict: true,
        error: "This product was changed in another tab or by another save. Reload to see the latest version.",
      };
    }
  } catch (error) {
    const message = constraintError(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
  return { ok: true, id, revision: nextRevision };
}

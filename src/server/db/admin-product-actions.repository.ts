// Owner-only bulk actions and "duplicate product". Server-only; callers must have passed ownerAuthMiddleware.
//
// Both follow saveProduct's discipline (admin-catalog.repository.ts): one D1 batch, one transaction. Every write sets a
// fresh revision, so an editor that was open on one of these products fails its next save with a conflict instead of
// silently undoing the action. Every batch ends with one audit row, guarded so it exists only if something changed.
import {
  type BulkProductAction,
  type BulkProductResult,
  type BulkProductState,
  type BulkSkip,
  copyName,
  copySlugRange,
  type DuplicateProductResult,
  nextCopySlug,
  planBulkAction,
} from "@/domain/admin-product-actions";
import type { AdminIdentity } from "@/domain/admin";
import type { ProductStatus } from "@/domain/product-admin";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

interface StateRow {
  id: number;
  status: ProductStatus;
  category_id: string;
  featured: number;
  has_colours: number;
  has_bare_colour: number;
}

/**
 * The selected products' current state. Primary-key lookups through json_each (one bound parameter however many ids).
 * A product is publishable when it has a colour and every colour has a picture, the rule productInputSchema applies.
 */
export const BULK_STATES_SQL = `SELECT p.id, p.status, p.category_id, p.featured,
         EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) AS has_colours,
         EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id
                   AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.variant_id = v.id)) AS has_bare_colour
       FROM products p WHERE p.id IN (SELECT value FROM json_each(?))`;

const IN_SELECTION = "id IN (SELECT value FROM json_each(?))";

/** The conditions repeat what the planner checked, so a product that changed since is skipped, not overwritten. */
export function updateFor(action: BulkProductAction, revision: string, now: string, ids: string): [string, unknown[]] {
  switch (action.action) {
    case "publish":
      return [
        `UPDATE products SET status = 'published', archived_at = NULL, revision = ?, updated_at = ?
         WHERE ${IN_SELECTION} AND status <> 'published'
           AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id)
           AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id
                             AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.variant_id = v.id))
         RETURNING id`,
        [revision, now, ids],
      ];
    case "unpublish":
      return [
        `UPDATE products SET status = 'draft', revision = ?, updated_at = ?
         WHERE ${IN_SELECTION} AND status = 'published' RETURNING id`,
        [revision, now, ids],
      ];
    case "archive":
      return [
        `UPDATE products SET status = 'archived', archived_at = COALESCE(archived_at, ?), revision = ?, updated_at = ?
         WHERE ${IN_SELECTION} AND status <> 'archived' RETURNING id`,
        [now, revision, now, ids],
      ];
    case "set_category":
      return [
        `UPDATE products SET category_id = ?, revision = ?, updated_at = ?
         WHERE ${IN_SELECTION} AND category_id <> ? AND EXISTS (SELECT 1 FROM categories WHERE id = ?) RETURNING id`,
        [action.categoryId, revision, now, ids, action.categoryId, action.categoryId],
      ];
    case "feature":
      return [
        `UPDATE products SET featured = 1, revision = ?, updated_at = ? WHERE ${IN_SELECTION} AND featured = 0 RETURNING id`,
        [revision, now, ids],
      ];
    case "unfeature":
      return [
        `UPDATE products SET featured = 0, revision = ?, updated_at = ? WHERE ${IN_SELECTION} AND featured = 1 RETURNING id`,
        [revision, now, ids],
      ];
  }
}

export interface BulkUpdateOptions {
  actor: AdminIdentity;
  action: BulkProductAction;
  now?: Date;
}

/**
 * Applies one action to the selected products. Two D1 round trips: read their states, then one batch holding the
 * UPDATE (with RETURNING, so the caller learns exactly which rows changed) and the audit row.
 *
 * Conflict handling. The action is declarative ("these products end up published"), so it is judged against each
 * product's state at the time of the write, not the state the list showed. A product that is already there, or that
 * cannot be published yet, is skipped and named in the result. The UPDATE repeats the planner's conditions, so a product
 * that changed between the read and the write is skipped too ("changed"), never overwritten. The audit row lists the
 * products the plan chose; in that rare race it can list one the UPDATE then skipped, and the result says which.
 */
export async function bulkUpdateProducts(db: D1Database, options: BulkUpdateOptions): Promise<BulkProductResult> {
  const { actor, action } = options;
  const now = (options.now ?? new Date()).toISOString();

  const reads: D1PreparedStatement[] = [db.prepare(BULK_STATES_SQL).bind(JSON.stringify(action.ids))];
  if (action.action === "set_category") {
    reads.push(db.prepare("SELECT id FROM categories WHERE id = ?").bind(action.categoryId));
  }
  const [stateResult, categoryResult] = await db.batch<StateRow | { id: string }>(reads);
  if (action.action === "set_category" && !categoryResult?.results.length) {
    return { ok: false, error: "That category no longer exists. Reload and pick another." };
  }
  const states = ((stateResult?.results ?? []) as StateRow[]).map((row): BulkProductState => ({
    id: row.id,
    status: row.status,
    categoryId: row.category_id,
    featured: row.featured === 1,
    publishable: row.has_colours === 1 && row.has_bare_colour === 0,
  }));

  const plan = planBulkAction(action, states);
  if (plan.apply.length === 0) return { ok: true, applied: [], skipped: plan.skipped, shopIds: [] };

  const revision = crypto.randomUUID();
  const eligible = JSON.stringify(plan.apply);
  const [sql, params] = updateFor(action, revision, now, eligible);
  const details: Record<string, string | number> = {
    name: `${plan.apply.length} ${plan.apply.length === 1 ? "product" : "products"}`,
    count: plan.apply.length,
  };
  if (action.action === "set_category") details.categoryId = action.categoryId;
  if (action.action === "publish") details.status = "published";
  if (action.action === "unpublish") details.status = "draft";
  if (action.action === "archive") details.status = "archived";

  const results = await db.batch<{ id: number }>([
    db.prepare(sql).bind(...params),
    auditStatement(db, actor, `product.bulk_${action.action}`, plan.apply.join(","), details, new Date(now), {
      sql: `EXISTS (SELECT 1 FROM products WHERE ${IN_SELECTION} AND revision = ?)`,
      params: [eligible, revision],
    }),
  ]);
  const applied = new Set((results[0]?.results ?? []).map((row) => row.id));
  const lost: BulkSkip[] = plan.apply.filter((id) => !applied.has(id)).map((id) => ({ id, reason: "changed" }));
  return {
    ok: true,
    applied: plan.apply.filter((id) => applied.has(id)),
    skipped: [...plan.skipped, ...lost],
    shopIds: plan.shop.filter((id) => applied.has(id)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicate

export interface DuplicateOptions {
  actor: AdminIdentity;
  id: number;
  /** Copy the original's picture rows. They point at the same stored files (see below). */
  includeImages: boolean;
  now?: Date;
}

const COLLISION = /UNIQUE constraint failed: products\.(?:slug|id)/i;
const ATTEMPTS = 3;

/**
 * Copies text, prices (cost price included), the category and every colour into a new draft with a new URL name
 * (`<slug>-copy`, then `-copy-2`, ...). It is not featured and has no orders. The copy runs inside the database
 * (INSERT ... SELECT from the original), so it cannot mix two versions of the original; only the new name and id are
 * worked out first. A second tab taking the same name or id fails on the UNIQUE constraint, and the copy retries.
 *
 * Pictures. With `includeImages` the copy gets its own product_images rows with the same R2 keys: no object is copied.
 * Nothing in the app deletes an R2 object (removing or replacing a picture only deletes that product's row, see
 * admin-media.functions.ts), so the two products cannot break each other's pictures. A future cleanup that deletes
 * objects must first check that no product_images.path of any product, and no categories.image, still names the key.
 */
export async function duplicateProduct(db: D1Database, options: DuplicateOptions): Promise<DuplicateProductResult> {
  const { actor, id, includeImages } = options;
  const now = (options.now ?? new Date()).toISOString();

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const [sourceResult, maxResult] = await db.batch<{ slug: string; name: string } | { id: number }>([
      db.prepare("SELECT slug, name FROM products WHERE id = ?").bind(id),
      db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM products"),
    ]);
    const source = sourceResult?.results[0] as { slug: string; name: string } | undefined;
    if (!source) return { ok: false, error: "This product no longer exists." };
    const newId = Number((maxResult?.results[0] as { id: number } | undefined)?.id ?? 1);

    // Range on the UNIQUE slug index: the copies of this product so far (a handful of rows).
    const range = copySlugRange(source.slug);
    const { results: taken } = await db
      .prepare("SELECT slug FROM products WHERE slug >= ? AND slug < ?")
      .bind(range.from, range.to)
      .all<{ slug: string }>();
    const slug = nextCopySlug(source.slug, new Set(taken.map((row) => row.slug)));
    if (!slug) return { ok: false, error: "This product has too many copies. Rename one of them first." };

    const revision = crypto.randomUUID();
    const name = copyName(source.name);
    const guard = { sql: "EXISTS (SELECT 1 FROM products WHERE id = ? AND revision = ?)", params: [newId, revision] };
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO products (id, slug, name, category_id, summary, details, note, price, regular_price, cost_price,
             status, featured, sort, archived_at, revision, created_at, updated_at)
           SELECT ?, ?, ?, category_id, summary, details, note, price, regular_price, cost_price,
             'draft', 0, sort, NULL, ?, ?, ?
           FROM products WHERE id = ?`,
        )
        .bind(newId, slug, name, revision, now, now, id),
      db
        .prepare(
          `INSERT INTO product_variants (product_id, position, name, swatch, availability)
           SELECT ?, position, name, swatch, availability FROM product_variants
           WHERE product_id = ? AND ${guard.sql}`,
        )
        .bind(newId, id, ...guard.params),
    ];
    if (includeImages) {
      statements.push(
        db
          .prepare(
            `INSERT INTO product_images (variant_id, position, path, alt)
             SELECT nv.id, i.position, i.path, i.alt
             FROM product_variants sv
             JOIN product_images i ON i.variant_id = sv.id
             JOIN product_variants nv ON nv.product_id = ? AND nv.position = sv.position
             WHERE sv.product_id = ? AND ${guard.sql}`,
          )
          .bind(newId, id, ...guard.params),
      );
    }
    statements.push(
      auditStatement(
        db,
        actor,
        "product.duplicated",
        String(newId),
        { name, status: "draft", from: id, images: includeImages },
        new Date(now),
        guard,
      ),
    );

    try {
      const [claim] = await db.batch(statements);
      if (claim?.meta.changes !== 1) return { ok: false, error: "This product no longer exists." };
      return { ok: true, id: newId, slug, revision };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!COLLISION.test(message) || attempt === ATTEMPTS) {
        if (COLLISION.test(message))
          return { ok: false, error: "Another product was created at the same moment. Try again." };
        throw error;
      }
    }
  }
  return { ok: false, error: "Could not copy this product. Try again." };
}

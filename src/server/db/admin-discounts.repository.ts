// Admin sales (P9.2). Server-only; callers have passed the Owner middleware. Discounts are never deleted: orders keep
// the id of the sale that priced them, so the Owner switches one off instead.
import type { AdminIdentity, AuditValue } from "@/domain/admin";
import type { AdminDiscount, DiscountInput, SaveDiscountResult } from "@/domain/discounts";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database } from "./d1";

interface DiscountRow {
  id: number;
  name: string;
  scope: AdminDiscount["scope"];
  category_id: string | null;
  product_id: number | null;
  type: AdminDiscount["type"];
  value: number;
  starts_at: string;
  ends_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  revision: string;
  target_name: string | null;
}

// The product or category the sale covers is joined by primary key (at most 200 rows), so the list shows names.
const COLUMNS = `d.id, d.name, d.scope, d.category_id, d.product_id, d.type, d.value, d.starts_at, d.ends_at, d.active,
  d.created_at, d.updated_at, d.revision, COALESCE(p.name, c.name) AS target_name`;
const FROM = `discounts d LEFT JOIN products p ON p.id = d.product_id LEFT JOIN categories c ON c.id = d.category_id`;

const toDiscount = (row: DiscountRow): AdminDiscount => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  categoryId: row.category_id,
  productId: row.product_id,
  type: row.type,
  value: row.value,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revision: row.revision,
  targetName: row.target_name,
});

/** Most sales the list returns. The Owner switches old ones off; a shop does not run hundreds. */
export const MAX_LISTED_DISCOUNTS = 200;

/** Newest first, through idx_discounts_admin (kind, created_at DESC, id DESC): no sort step. Sales only (P9.3 adds coupons). */
export const LIST_DISCOUNTS_SQL = `SELECT ${COLUMNS} FROM ${FROM} WHERE d.kind = 'sale'
  ORDER BY d.created_at DESC, d.id DESC LIMIT ${MAX_LISTED_DISCOUNTS}`;

export async function listDiscounts(db: D1Database): Promise<AdminDiscount[]> {
  const { results } = await db.prepare(LIST_DISCOUNTS_SQL).all<DiscountRow>();
  return results.map(toDiscount);
}

async function readDiscount(db: D1Database, id: number): Promise<AdminDiscount | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE d.id = ? AND d.kind = 'sale'`)
    .bind(id)
    .first<DiscountRow>();
  return row ? toDiscount(row) : null;
}

const CONFLICT = {
  ok: false,
  conflict: true,
  error: "This sale was changed in another tab. Reload to see the latest version.",
} as const;

/**
 * Creates (id null) or updates a sale in one batch. The first statement claims the row (the INSERT, or an UPDATE that
 * matches the loaded revision and sets a new one); the audit row is written in the same batch and only when the claim
 * took effect. A stale revision changes nothing and returns a conflict.
 */
export async function saveDiscount(
  db: D1Database,
  actor: AdminIdentity,
  request: { id: number | null; revision: string; input: DiscountInput },
  now = new Date(),
): Promise<SaveDiscountResult> {
  const { input } = request;
  // Targets are checked here rather than by a foreign key (the table has none, like order_items).
  if (input.scope === "category") {
    const found = await db.prepare("SELECT 1 AS ok FROM categories WHERE id = ?").bind(input.categoryId).first();
    if (!found) return { ok: false, error: "That category no longer exists." };
  }
  let productName: string | null = null;
  if (input.scope === "product") {
    const found = await db
      .prepare("SELECT name FROM products WHERE id = ?")
      .bind(input.productId)
      .first<{ name: string }>();
    if (!found) return { ok: false, error: "That product no longer exists." };
    productName = found.name;
  }

  const at = now.toISOString();
  const nextRevision = crypto.randomUUID();
  const details: Record<string, AuditValue> = {
    name: input.name,
    scope: input.scope,
    category: input.categoryId,
    product: productName,
    type: input.type,
    value: input.value,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    active: input.active,
  };
  const fields = [
    input.name,
    input.scope,
    input.categoryId,
    input.productId,
    input.type,
    input.value,
    input.startsAt,
    input.endsAt,
    input.active ? 1 : 0,
  ];

  if (request.id === null) {
    const [claim] = await db.batch([
      db
        .prepare(
          `INSERT INTO discounts (name, kind, scope, category_id, product_id, type, value, starts_at, ends_at, active,
             created_at, updated_at, revision)
           VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...fields, at, at, nextRevision),
      // The new row's id is not known until the insert runs, so this audit row reads it back by revision.
      db
        .prepare(
          `INSERT INTO admin_audit (id, actor_id, actor_username, actor_role, action, target_id, details, created_at)
           SELECT ?, ?, ?, ?, 'discount.created', CAST(d.id AS TEXT), ?, ? FROM discounts d WHERE d.revision = ?`,
        )
        .bind(crypto.randomUUID(), actor.id, actor.username, actor.role, JSON.stringify(details), at, nextRevision),
    ]);
    if (claim?.meta.changes !== 1) return { ok: false, error: "The sale could not be saved. Try again." };
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE d.revision = ?`)
      .bind(nextRevision)
      .first<DiscountRow>();
    return row ? { ok: true, discount: toDiscount(row) } : { ok: false, error: "The sale could not be saved." };
  }

  const guard = {
    sql: "EXISTS (SELECT 1 FROM discounts WHERE id = ? AND revision = ?)",
    params: [request.id, nextRevision],
  };
  const [claim] = await db.batch([
    db
      .prepare(
        `UPDATE discounts SET name = ?, scope = ?, category_id = ?, product_id = ?, type = ?, value = ?,
           starts_at = ?, ends_at = ?, active = ?, updated_at = ?, revision = ?
         WHERE id = ? AND kind = 'sale' AND revision = ?`,
      )
      .bind(...fields, at, nextRevision, request.id, request.revision),
    auditStatement(db, actor, "discount.updated", String(request.id), details, now, guard),
  ]);
  if (claim?.meta.changes !== 1) return CONFLICT;
  const discount = await readDiscount(db, request.id);
  return discount ? { ok: true, discount } : CONFLICT;
}

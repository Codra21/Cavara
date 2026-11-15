// Admin coupons (P9.3). Server-only; callers have passed the Owner middleware. Coupons live in `discounts` next to the
// sales (kind 'coupon'). Like sales they are never deleted, because orders keep the coupon's id and code, so the Owner
// switches one off. A saved coupon's code cannot change: orders and customers know it by that code, and a rename
// would let a used code come back under a fresh use count. Saving a coupon needs no snapshot refresh, because checkout
// reads coupons from D1 by code and never from the cached catalogue.
import type { AdminIdentity, AuditValue } from "@/domain/admin";
import type { AdminCoupon, CouponInput, SaveCouponResult } from "@/domain/coupons";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database } from "./d1";

interface CouponRow {
  id: number;
  name: string;
  code: string;
  type: AdminCoupon["type"];
  value: number;
  min_order: number | null;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  starts_at: string;
  ends_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  revision: string;
}

const COLUMNS = `id, name, code, type, value, min_order, max_discount, usage_limit, used_count, starts_at, ends_at,
  active, created_at, updated_at, revision`;

const toCoupon = (row: CouponRow): AdminCoupon => ({
  id: row.id,
  name: row.name,
  code: row.code,
  type: row.type,
  value: row.value,
  minOrder: row.min_order,
  maxDiscount: row.max_discount,
  usageLimit: row.usage_limit,
  usedCount: row.used_count,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revision: row.revision,
});

/** Most coupons the list returns. The Owner switches old ones off; a shop does not run hundreds. */
export const MAX_LISTED_COUPONS = 200;

/** Newest first, through idx_discounts_admin_coupons (partial on kind 'coupon'): no sort step. */
export const LIST_COUPONS_SQL = `SELECT ${COLUMNS} FROM discounts WHERE kind = 'coupon'
  ORDER BY created_at DESC, id DESC LIMIT ${MAX_LISTED_COUPONS}`;

export async function listCoupons(db: D1Database): Promise<AdminCoupon[]> {
  const { results } = await db.prepare(LIST_COUPONS_SQL).all<CouponRow>();
  return results.map(toCoupon);
}

async function readCoupon(db: D1Database, id: number): Promise<AdminCoupon | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM discounts WHERE id = ? AND kind = 'coupon'`)
    .bind(id)
    .first<CouponRow>();
  return row ? toCoupon(row) : null;
}

const CONFLICT = {
  ok: false,
  conflict: true,
  error: "This coupon was changed in another tab. Reload to see the latest version.",
} as const;

const DUPLICATE = { ok: false, error: "Another coupon already uses that code." } as const;

const isDuplicateCode = (error: unknown) =>
  /UNIQUE constraint failed: discounts\.code/i.test(error instanceof Error ? error.message : String(error));

/**
 * Creates (id null) or updates a coupon in one batch. The first statement claims the row (the INSERT, or an UPDATE that
 * matches the loaded revision and sets a new one); the audit row is in the same batch and only written when the claim
 * took effect. A stale revision changes nothing and returns a conflict. `used_count` is never written here.
 */
export async function saveCoupon(
  db: D1Database,
  actor: AdminIdentity,
  request: { id: number | null; revision: string; input: CouponInput },
  now = new Date(),
): Promise<SaveCouponResult> {
  const { input } = request;
  const at = now.toISOString();
  const nextRevision = crypto.randomUUID();
  const details: Record<string, AuditValue> = {
    name: input.name,
    code: input.code,
    type: input.type,
    value: input.value,
    minOrder: input.minOrder,
    maxDiscount: input.maxDiscount,
    usageLimit: input.usageLimit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    active: input.active,
  };
  const fields = [
    input.name,
    input.type,
    input.value,
    input.minOrder,
    input.maxDiscount,
    input.usageLimit,
    input.startsAt,
    input.endsAt,
    input.active ? 1 : 0,
  ];

  if (request.id === null) {
    try {
      const [claim] = await db.batch([
        db
          .prepare(
            `INSERT INTO discounts (name, kind, scope, type, value, min_order, max_discount, usage_limit, starts_at,
               ends_at, active, created_at, updated_at, revision, code)
             VALUES (?, 'coupon', 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(...fields, at, at, nextRevision, input.code),
        // The new row's id is not known until the insert runs, so this audit row reads it back by revision.
        db
          .prepare(
            `INSERT INTO admin_audit (id, actor_id, actor_username, actor_role, action, target_id, details, created_at)
             SELECT ?, ?, ?, ?, 'coupon.created', CAST(d.id AS TEXT), ?, ? FROM discounts d WHERE d.revision = ?`,
          )
          .bind(crypto.randomUUID(), actor.id, actor.username, actor.role, JSON.stringify(details), at, nextRevision),
      ]);
      if (claim?.meta.changes !== 1) return { ok: false, error: "The coupon could not be saved. Try again." };
    } catch (error) {
      if (isDuplicateCode(error)) return DUPLICATE;
      throw error;
    }
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM discounts WHERE revision = ?`)
      .bind(nextRevision)
      .first<CouponRow>();
    return row ? { ok: true, coupon: toCoupon(row) } : { ok: false, error: "The coupon could not be saved." };
  }

  const current = await readCoupon(db, request.id);
  if (!current) return { ok: false, error: "That coupon no longer exists." };
  if (current.code !== input.code) return { ok: false, error: "The code of a saved coupon cannot change." };

  const guard = {
    sql: "EXISTS (SELECT 1 FROM discounts WHERE id = ? AND revision = ?)",
    params: [request.id, nextRevision],
  };
  const [claim] = await db.batch([
    db
      .prepare(
        `UPDATE discounts SET name = ?, type = ?, value = ?, min_order = ?, max_discount = ?, usage_limit = ?,
           starts_at = ?, ends_at = ?, active = ?, updated_at = ?, revision = ?
         WHERE id = ? AND kind = 'coupon' AND revision = ?`,
      )
      .bind(...fields, at, nextRevision, request.id, request.revision),
    auditStatement(db, actor, "coupon.updated", String(request.id), details, now, guard),
  ]);
  if (claim?.meta.changes !== 1) return CONFLICT;
  const coupon = await readCoupon(db, request.id);
  return coupon ? { ok: true, coupon } : CONFLICT;
}

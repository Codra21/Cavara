// Blocked phone numbers (P10.5). Server-only; callers have passed the Owner middleware. Blocking only stops new orders
// (orders.repository.ts checks blocked_phones inside the order insert); it never touches the number's existing orders.
// Audit rows name the number by a keyed HMAC, because the audit log holds no customer contact data.
import { createHmac } from "node:crypto";
import type { AdminIdentity } from "@/domain/admin";
import type { BlockedPhone, BlockPhoneInput } from "@/domain/blocked-phones";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database } from "./d1";

/** Most numbers the list returns. A shop blocks a handful; the list is for unblocking mistakes. */
export const MAX_LISTED_BLOCKED = 200;

/** Newest first through idx_blocked_phones_created: no sort step. */
export const LIST_BLOCKED_SQL = `SELECT phone, reason, created_at AS createdAt, created_by AS createdBy
  FROM blocked_phones ORDER BY created_at DESC, phone LIMIT ${MAX_LISTED_BLOCKED}`;

export function phoneAuditId(phone: string, secret: string): string {
  if (!secret) throw new Error("phoneAuditId requires a non-empty secret");
  return createHmac("sha256", secret).update(`cavara-blocked-phone-v1:${phone}`).digest("hex").slice(0, 12);
}

export async function listBlockedPhones(db: D1Database): Promise<BlockedPhone[]> {
  const { results } = await db.prepare(LIST_BLOCKED_SQL).all<BlockedPhone>();
  return results;
}

/** One primary-key probe: is this number blocked? */
export async function isPhoneBlocked(db: D1Database, phone: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS found FROM blocked_phones WHERE phone = ?").bind(phone).first();
  return row !== null;
}

/**
 * Blocks a number. The audit row comes first and is guarded on the number not being blocked yet, then the insert runs,
 * both in one batch, so blocking twice writes one audit row. Returns whether the number was newly blocked.
 */
export async function blockPhone(
  db: D1Database,
  actor: AdminIdentity,
  input: BlockPhoneInput,
  auditSecret: string,
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const [, insert] = await db.batch([
    auditStatement(
      db,
      actor,
      "phone.blocked",
      phoneAuditId(input.phone, auditSecret),
      { hasReason: input.reason !== "", orderId: input.orderId ?? null },
      now,
      { sql: "NOT EXISTS (SELECT 1 FROM blocked_phones WHERE phone = ?)", params: [input.phone] },
    ),
    db
      .prepare("INSERT OR IGNORE INTO blocked_phones (phone, reason, created_at, created_by) VALUES (?, ?, ?, ?)")
      .bind(input.phone, input.reason, at, actor.username),
  ]);
  return insert?.meta.changes === 1;
}

/** Unblocks a number: the audit row is guarded on the number being blocked, then the delete runs. */
export async function unblockPhone(
  db: D1Database,
  actor: AdminIdentity,
  phone: string,
  auditSecret: string,
  now = new Date(),
): Promise<boolean> {
  const [, removal] = await db.batch([
    auditStatement(db, actor, "phone.unblocked", phoneAuditId(phone, auditSecret), {}, now, {
      sql: "EXISTS (SELECT 1 FROM blocked_phones WHERE phone = ?)",
      params: [phone],
    }),
    db.prepare("DELETE FROM blocked_phones WHERE phone = ?").bind(phone),
  ]);
  return removal?.meta.changes === 1;
}

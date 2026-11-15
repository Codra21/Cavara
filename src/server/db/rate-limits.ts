// Fixed-window attempt counters in D1 (order_rate_limits, admin_login_limits). Server-only.
//
// One statement per key does the work: insert the key, or bump it, or start a new window over an expired row, or, for a
// key that is already at its limit, change nothing. An upsert whose DO UPDATE ... WHERE is false writes nothing and
// RETURNING gives no row, which the caller reads as "blocked". So a client past its limit costs index reads only, and a
// flood cannot burn the D1 write quota. All keys go in one batch: one round trip.
//
// Expired rows are overwritten when their key comes back. Keys that never return are deleted by an indexed range
// delete that runs on about 1 call in SWEEP_ONE_IN, not on every call, so the table stays bounded without a delete per
// request.
import type { D1Database } from "./d1";

export type LimitTable = "order_rate_limits" | "admin_login_limits";

/** About one call in this many also deletes expired rows. */
export const SWEEP_ONE_IN = 20;

export interface LimitCheck {
  key: string;
  /** Attempts allowed in the window. The attempt that reaches this number is still allowed. */
  max: number;
}

/** The statement for one key. Bind order: key, expires, now, now, now, max. Table names are constants, never input. */
export const limitUpsertSql = (table: LimitTable) =>
  `INSERT INTO ${table} (key, attempts, expires_at) VALUES (?, 1, ?)
   ON CONFLICT (key) DO UPDATE SET
     attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
     expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
   WHERE expires_at <= ? OR attempts < ?
   RETURNING attempts`;

export const limitSweepSql = (table: LimitTable) => `DELETE FROM ${table} WHERE expires_at <= ?`;

/**
 * Counts this attempt against every key and reports, per key, whether it is within its limit. `sweep` says whether
 * this call also deletes expired rows (default: about 1 call in SWEEP_ONE_IN).
 */
export async function consumeLimits(
  db: D1Database,
  table: LimitTable,
  checks: LimitCheck[],
  now: number,
  windowMs: number,
  sweep: boolean = Math.random() < 1 / SWEEP_ONE_IN,
): Promise<boolean[]> {
  const expires = now + windowMs;
  const results = await db.batch<{ attempts: number }>([
    ...checks.map(({ key, max }) => db.prepare(limitUpsertSql(table)).bind(key, expires, now, now, now, max)),
    ...(sweep ? [db.prepare(limitSweepSql(table)).bind(now)] : []),
  ]);
  return checks.map((check, index) => {
    const attempts = results[index]?.results[0]?.attempts;
    return attempts !== undefined && attempts <= check.max;
  });
}

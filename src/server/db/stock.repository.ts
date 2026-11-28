// Stock counts and the movement ledger. Server-only.
//
// A colour is counted when product_variants.stock is not NULL. Every statement that changes a count also sets the
// colour's availability in the same UPDATE (out_of_stock at 0 or below, in_stock above 0, preorder untouched), and
// writes its movement row in the same batch, so the count, the shop's availability and the history cannot disagree.
//
// D1 runs a batch as one transaction, but a statement that changes 0 rows does not undo the others. So each batch
// below evaluates one predicate P before it changes anything: the movement row and the audit row are inserted
// `WHERE P`, and the UPDATE that follows repeats P. Nothing in between can change the answer, so either all of them
// apply or none do, and the caller checks the UPDATE's meta.changes.
import type { AdminIdentity, AuditValue } from "@/domain/admin";
import {
  type AdjustStockInput,
  type AdjustStockResult,
  type StockLine,
  type StockMovement,
  type StockMovementPage,
  type StockReason,
  type StopCountingInput,
  type StopCountingResult,
  STOCK_MOVEMENT_PAGE_SIZE,
} from "@/domain/stock";
import type { Availability } from "@/lib/types";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

/** Availability a counted colour gets from `stockExpr`; the SQL twin of availabilityFromStock. */
const availabilitySql = (stockExpr: string) =>
  `CASE WHEN availability = 'preorder' THEN 'preorder' WHEN ${stockExpr} <= 0 THEN 'out_of_stock' ELSE 'in_stock' END`;

// count_epoch is the colour's epoch when the movement was written (see HELD_BY_ORDER).
const MOVEMENT_COLUMNS = `product_id, variant_id, variant_name, delta, reason, order_id, note, actor_username,
  balance_after, created_at, count_epoch`;

interface MovementRow {
  id: number;
  variant_id: number;
  variant_name: string;
  delta: number;
  reason: StockReason;
  order_id: string | null;
  note: string;
  actor_username: string | null;
  balance_after: number;
  created_at: string;
}

/** A product's movements, newest first, 50 per page by keyset on idx_stock_movements_product. */
export async function listStockMovements(
  db: D1Database,
  productId: number,
  after: { createdAt: string; id: number } | null,
): Promise<StockMovementPage> {
  const { results } = await db
    .prepare(
      `SELECT id, variant_id, variant_name, delta, reason, order_id, note, actor_username, balance_after, created_at
       FROM stock_movements WHERE product_id = ? ${after ? "AND (created_at, id) < (?, ?)" : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...(after ? [productId, after.createdAt, after.id] : [productId]), STOCK_MOVEMENT_PAGE_SIZE + 1)
    .all<MovementRow>();
  const page = results.slice(0, STOCK_MOVEMENT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    movements: page.map((row): StockMovement => ({
      id: row.id,
      variantId: row.variant_id,
      variantName: row.variant_name,
      delta: row.delta,
      reason: row.reason,
      orderId: row.order_id,
      note: row.note,
      actorUsername: row.actor_username,
      balanceAfter: row.balance_after,
      createdAt: row.created_at,
    })),
    next: results.length > STOCK_MOVEMENT_PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

export type AdjustOutcome = AdjustStockResult & { availabilityChanged?: boolean };

/**
 * First count, stock in or stock out for one colour. Stock out never takes a count below 0. The product's revision is
 * not touched, so an open product editor still saves.
 */
export async function adjustStock(
  db: D1Database,
  actor: AdminIdentity,
  input: AdjustStockInput,
  now = new Date(),
): Promise<AdjustOutcome> {
  const variant = await db
    .prepare("SELECT name, stock, availability FROM product_variants WHERE id = ? AND product_id = ?")
    .bind(input.variantId, input.productId)
    .first<{ name: string; stock: number | null; availability: Availability }>();
  if (!variant) return { ok: false, error: "This colour no longer exists. Reload the product." };

  const starting = input.action === "start";
  if (starting && variant.stock !== null) return { ok: false, error: "This colour is already counted. Reload." };
  if (!starting && variant.stock === null) return { ok: false, error: "Start counting this colour first." };
  if (input.action === "out" && (variant.stock ?? 0) < input.quantity) {
    return {
      ok: false,
      error: `Only ${Math.max(0, variant.stock ?? 0)} in stock, so ${input.quantity} cannot go out.`,
    };
  }

  const delta = input.action === "out" ? -input.quantity : input.quantity;
  const reason: StockReason = starting ? "correction" : input.action === "in" ? "stock_in" : "stock_out";
  const at = now.toISOString();
  // P: the state this change expects, evaluated before the UPDATE changes it.
  const predicate = starting
    ? "v.id = ? AND v.product_id = ? AND v.stock IS NULL"
    : input.action === "out"
      ? "v.id = ? AND v.product_id = ? AND v.stock IS NOT NULL AND v.stock + ? >= 0"
      : "v.id = ? AND v.product_id = ? AND v.stock IS NOT NULL";
  const predicateParams =
    input.action === "out" ? [input.variantId, input.productId, delta] : [input.variantId, input.productId];
  const newStock = starting ? "?" : "v.stock + ?";
  const newStockParams = [starting ? input.quantity : delta];

  const details: Record<string, AuditValue> = {
    colour: variant.name,
    action: input.action,
    quantity: input.quantity,
    note: input.note,
  };
  const statements: D1PreparedStatement[] = [];
  // A first count of 0 has no movement to record: a movement needs a non-zero delta.
  if (delta !== 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
           SELECT v.product_id, v.id, v.name, ?, ?, NULL, ?, ?, ${newStock}, ?, v.count_epoch FROM product_variants v WHERE ${predicate}`,
        )
        .bind(delta, reason, input.note, actor.username, ...newStockParams, at, ...predicateParams),
    );
  }
  statements.push(
    auditStatement(db, actor, starting ? "stock.started" : "stock.adjusted", String(input.productId), details, now, {
      sql: `EXISTS (SELECT 1 FROM product_variants v WHERE ${predicate})`,
      params: predicateParams,
    }),
    db
      .prepare(
        `UPDATE product_variants AS v SET stock = ${newStock}, availability = ${availabilitySql(newStock)}
         WHERE ${predicate}
         RETURNING stock, availability`,
      )
      .bind(...newStockParams, ...newStockParams, ...predicateParams),
  );
  const results = await db.batch(statements);
  const after = results.at(-1)?.results[0] as { stock: number; availability: Availability } | undefined;
  if (!after) {
    return { ok: false, error: "This colour's count changed in the meantime. Reload and try again." };
  }
  return {
    ok: true,
    stock: after.stock,
    availability: after.availability,
    availabilityChanged: after.availability !== variant.availability,
  };
}

/**
 * Turns counting off for one colour: stock becomes NULL and availability stays as it is, so no snapshot patch is
 * needed. The colour's count epoch goes up, so orders placed under the old count never move the next count. No movement row (a movement needs a non-zero delta); the audit row records the last count. P also names that
 * count, so a stock change between the read and the batch refuses this one instead of recording a stale number.
 */
export async function stopCounting(
  db: D1Database,
  actor: AdminIdentity,
  input: StopCountingInput,
  now = new Date(),
): Promise<StopCountingResult> {
  const variant = await db
    .prepare("SELECT name, stock FROM product_variants WHERE id = ? AND product_id = ?")
    .bind(input.variantId, input.productId)
    .first<{ name: string; stock: number | null }>();
  if (!variant) return { ok: false, error: "This colour no longer exists. Reload the product." };
  if (variant.stock === null) return { ok: false, error: "This colour is not counted. Reload." };

  const predicate = "v.id = ? AND v.product_id = ? AND v.stock = ?";
  const params = [input.variantId, input.productId, variant.stock];
  const results = await db.batch([
    auditStatement(
      db,
      actor,
      "stock.stopped",
      String(input.productId),
      { colour: variant.name, lastCount: variant.stock },
      now,
      { sql: `EXISTS (SELECT 1 FROM product_variants v WHERE ${predicate})`, params },
    ),
    db
      .prepare(`UPDATE product_variants AS v SET stock = NULL, count_epoch = count_epoch + 1 WHERE ${predicate}`)
      .bind(...params),
  ]);
  if (results.at(-1)?.meta.changes !== 1) {
    return { ok: false, error: "This colour's count changed in the meantime. Reload and try again." };
  }
  return { ok: true };
}

// Orders ---------------------------------------------------------------------------------------------------------

const orderExists = "EXISTS (SELECT 1 FROM orders WHERE id = ?)";

/**
 * The lines as the JSON the order statements read: [[colour id, qty], ...]. D1 allows 100 bound parameters per
 * statement, and an order may hold 30 lines, so they travel as one json_each parameter. Colours are named by id, which
 * a product save never renumbers, not by position, which it can.
 */
export const stockLinesJson = (lines: { variantId: number; qty: number }[]) =>
  JSON.stringify(lines.map((line) => [line.variantId, line.qty]));

/**
 * SQL (one lines-JSON parameter) that is true when every line can still be sold. The order insert runs only when
 * this holds. The joins are left joins on purpose: an inner join would drop a colour deleted since the lines were
 * read, NOT EXISTS would see no row, and the order would save for a missing colour or an unpublished product.
 */
export const NO_SHORT_LINE = `NOT EXISTS (
  SELECT 1 FROM json_each(?) j
  LEFT JOIN product_variants v ON v.id = json_extract(j.value, '$[0]')
  LEFT JOIN products p ON p.id = v.product_id
  WHERE v.id IS NULL OR p.status <> 'published' OR v.availability <> 'in_stock'
    OR (v.stock IS NOT NULL AND v.stock < json_extract(j.value, '$[1]')))`;

const ORDER_LINES = `SELECT json_extract(j.value, '$[0]') AS variant_id, json_extract(j.value, '$[1]') AS qty
  FROM json_each(?) j`;

/**
 * Takes the order's counted lines out of stock and records a movement for each. Both statements run only when the
 * order row (inserted by the statement before) exists, so an order refused for a short colour changes nothing.
 * Uncounted colours (stock NULL) are skipped. A counted colour on pre-order may go below 0.
 */
export function reserveStockStatements(
  db: D1Database,
  orderId: string,
  lines: { variantId: number; qty: number }[],
  at: string,
): D1PreparedStatement[] {
  const json = stockLinesJson(lines);
  return [
    db
      .prepare(
        `UPDATE product_variants SET stock = stock - m.qty,
           availability = ${availabilitySql("stock - m.qty")}
         FROM (${ORDER_LINES}) AS m
         WHERE product_variants.id = m.variant_id AND product_variants.stock IS NOT NULL AND ${orderExists}`,
      )
      .bind(json, orderId),
    // After the UPDATE, v.stock is the balance after this order.
    db
      .prepare(
        `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
         SELECT v.product_id, v.id, v.name, -m.qty, 'order', ?, '', NULL, v.stock, ?, v.count_epoch
         FROM (${ORDER_LINES}) AS m
         JOIN product_variants v ON v.id = m.variant_id
         WHERE v.stock IS NOT NULL AND ${orderExists}`,
      )
      .bind(orderId, at, json, orderId),
  ];
}

/**
 * What a cancel returns, per colour: everything the order still holds (its order and reopen movements net of its
 * cancels). Nothing for a colour that was not counted when the order was placed, and nothing from before the colour's
 * current count started: only movements in the colour's current count epoch (stopCounting bumps it) are counted, so
 * stop, count again and cancel an old order cannot add stock the new count already includes.
 */
const HELD_BY_ORDER = `SELECT sm.variant_id, -SUM(sm.delta) AS qty FROM stock_movements sm
  JOIN product_variants cv ON cv.id = sm.variant_id AND cv.count_epoch = sm.count_epoch
  WHERE sm.order_id = ? GROUP BY sm.variant_id HAVING -SUM(sm.delta) > 0`;

/** What a reopen takes again, per colour: the quantity its cancel returned, if that was under the current count. */
const RETURNED_BY_CANCEL = `SELECT sm.variant_id, MAX(sm.delta) AS qty FROM stock_movements sm
  JOIN product_variants cv ON cv.id = sm.variant_id AND cv.count_epoch = sm.count_epoch
  WHERE sm.order_id = ? AND sm.reason = 'order_cancel' GROUP BY sm.variant_id`;

/**
 * Cancelling returns the order's stock; reopening takes it again. Two statements, guarded on the status change's
 * token (`guard`) like the rest of that batch. They name a colour by its variant id from the order's own movements,
 * so a colour that changed position since the order is found, and a removed colour has no row to update or record.
 */
export function orderStockStatements(
  db: D1Database,
  kind: "cancel" | "reopen",
  orderId: string,
  actor: AdminIdentity,
  at: string,
  guard: { sql: string; params: unknown[] },
): D1PreparedStatement[] {
  const cancel = kind === "cancel";
  const source = cancel ? HELD_BY_ORDER : RETURNED_BY_CANCEL;
  const sign = cancel ? "+" : "-";
  return [
    db
      .prepare(
        `UPDATE product_variants SET stock = stock ${sign} m.qty,
           availability = ${availabilitySql(`stock ${sign} m.qty`)}
         FROM (${source}) AS m
         WHERE product_variants.id = m.variant_id AND product_variants.stock IS NOT NULL AND ${guard.sql}`,
      )
      .bind(orderId, ...guard.params),
    db
      .prepare(
        `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
         SELECT v.product_id, v.id, v.name, ${cancel ? "m.qty" : "-m.qty"}, ?, ?, '', ?, v.stock, ?, v.count_epoch
         FROM (${source}) AS m JOIN product_variants v ON v.id = m.variant_id
         WHERE v.stock IS NOT NULL AND ${guard.sql}`,
      )
      .bind(cancel ? "order_cancel" : "order_reopen", orderId, actor.username, at, orderId, ...guard.params),
  ];
}

/** SQL (one order-id parameter) that is true when every colour has enough left for a reopen to take it again. */
export const REOPEN_FITS = `NOT EXISTS (
  SELECT 1 FROM (${RETURNED_BY_CANCEL}) AS m JOIN product_variants v ON v.id = m.variant_id
  WHERE v.stock IS NOT NULL AND v.availability <> 'preorder' AND v.stock < m.qty)`;

/** The colours a reopen cannot take again, for the message. Empty when it fits. */
export async function readReopenShortages(db: D1Database, orderId: string): Promise<StockLine[]> {
  const { results } = await db
    .prepare(
      `SELECT p.name AS productName, v.name AS variantName, v.availability, v.stock, m.qty
       FROM (${RETURNED_BY_CANCEL}) AS m
       JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       WHERE v.stock IS NOT NULL AND v.availability <> 'preorder' AND v.stock < m.qty`,
    )
    .bind(orderId)
    .all<StockLine>();
  return results;
}

/** Products whose count crossed 0 in the movements one status change wrote, so their shop copy needs a patch. */
export async function readCrossedProducts(db: D1Database, orderId: string, at: string): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT product_id FROM stock_movements
       WHERE order_id = ? AND created_at = ? AND ((balance_after - delta > 0) <> (balance_after > 0))`,
    )
    .bind(orderId, at)
    .all<{ product_id: number }>();
  // At most one row per colour in the order (30 lines), so de-duplicating here beats a temp B-tree for DISTINCT.
  return [...new Set(results.map((row) => row.product_id))];
}

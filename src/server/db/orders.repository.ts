// Guest order writes and lookups. Server-only. Every query is a primary-key or indexed lookup (D1 read budget).
import type { CouponRule } from "@/domain/coupons";
import { type CheckoutInput, type DeliveryZone, MAX_OPEN_ORDERS } from "@/domain/orders";
import type { Availability } from "@/lib/types";
import type { D1Database } from "./d1";
import { consumeLimits } from "./rate-limits";
import { NO_SHORT_LINE, reserveStockStatements, stockLinesJson } from "./stock.repository";

export interface OrderReplay {
  id: string;
  reference: string;
  payload_hash: string;
  total: number;
}

export async function findOrderByIdempotencyKey(db: D1Database, key: string): Promise<OrderReplay | null> {
  return db
    .prepare("SELECT id, reference, payload_hash, total FROM orders WHERE idempotency_key = ?")
    .bind(key)
    .first<OrderReplay>();
}

/**
 * Counts this attempt against every key, then reports whether all are within their limits. A key already at its limit
 * is not written again (see rate-limits.ts). Runs before the catalogue lookups, so a flood of bad requests is cut off
 * cheaply.
 */
export async function consumeOrderLimits(
  db: D1Database,
  limits: { key: string; max: number }[],
  now: number,
  windowMs: number,
  sweep?: boolean,
): Promise<boolean> {
  const within = await consumeLimits(db, "order_rate_limits", limits, now, windowMs, sweep);
  return within.every(Boolean);
}

/**
 * Whether a phone is blocked and how many of its orders are still 'new'. One statement: a primary-key probe on
 * blocked_phones and a count over the partial index idx_orders_phone_new. Read before the rate limits so a refused
 * number writes nothing; insertOrder re-checks both atomically.
 */
export const PHONE_STANDING_SQL = `SELECT EXISTS (SELECT 1 FROM blocked_phones WHERE phone = ?) AS blocked,
  (SELECT COUNT(*) FROM orders WHERE phone = ? AND status = 'new') AS open_orders`;

export async function readPhoneStanding(
  db: D1Database,
  phone: string,
): Promise<{ blocked: boolean; openOrders: number }> {
  const row = await db.prepare(PHONE_STANDING_SQL).bind(phone, phone).first<{ blocked: number; open_orders: number }>();
  return { blocked: row?.blocked === 1, openOrders: row?.open_orders ?? 0 };
}

interface CouponRow {
  id: number;
  code: string;
  type: CouponRule["type"];
  value: number;
  min_order: number | null;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  active: number;
  starts_at: string;
  ends_at: string | null;
}

export const COUPON_BY_CODE_SQL = `SELECT id, code, type, value, min_order, max_discount, usage_limit, used_count, active,
  starts_at, ends_at FROM discounts WHERE code = ? AND kind = 'coupon'`;

/** One coupon by its code, through the UNIQUE index on discounts.code (one row read). */
export async function readCouponByCode(db: D1Database, code: string): Promise<CouponRule | null> {
  const row = await db.prepare(COUPON_BY_CODE_SQL).bind(code).first<CouponRow>();
  return row
    ? {
        id: row.id,
        code: row.code,
        type: row.type,
        value: row.value,
        minOrder: row.min_order,
        maxDiscount: row.max_discount,
        usageLimit: row.usage_limit,
        usedCount: row.used_count,
        active: row.active === 1,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }
    : null;
}

export interface Selection {
  productId: number;
  /** The product's category id, which a category sale is matched against. */
  category: string;
  /** The product category's parent id when it is a subcategory, so parent category sales also apply. */
  parentCategoryId: string | null;
  variant: number;
  productName: string;
  variantName: string;
  status: string;
  availability: Availability;
  /** The product's list price (`products.price`), before any sale. */
  unitPrice: number;
  costPrice: number | null;
  /** The colour's count, or null when it is not counted. */
  stock: number | null;
  /** The colour's row id. Stock is reserved by this, not by `variant`, a position a product save can renumber. */
  variantId: number;
  /** Product weight in grams; null counts as 1000 g. */
  weightG: number | null;
}

/** A line as it is saved: `unitPrice` is what is charged, `listPrice` what it cost before the sale that took the rest. */
export type OrderLine = Selection & { qty: number; listPrice: number; discountId: number | null };

/** Current product and colour data for each bag line, by primary key and UNIQUE (product_id, position). */
export async function readSelections(
  db: D1Database,
  items: Pick<CheckoutInput["items"][number], "productId" | "variant">[],
): Promise<Map<string, Selection>> {
  const { results } = await db
    .prepare(
      `SELECT v.id AS variantId, v.product_id AS productId, p.category_id AS category, c.parent_id AS parentCategoryId, v.position AS variant, p.name AS productName, v.name AS variantName,
         p.status, v.availability, p.price AS unitPrice, p.cost_price AS costPrice, v.stock, p.weight_g AS weightG
       FROM json_each(?) j
       JOIN product_variants v
         ON v.product_id = json_extract(j.value, '$[0]') AND v.position = json_extract(j.value, '$[1]')
       JOIN products p ON p.id = v.product_id
       LEFT JOIN categories c ON c.id = p.category_id`,
    )
    .bind(JSON.stringify(items.map((item) => [item.productId, item.variant])))
    .all<Selection>();
  return new Map(results.map((row) => [`${row.productId}:${row.variant}`, row]));
}

export async function readActiveZone(db: D1Database, id: string): Promise<DeliveryZone | null> {
  return db
    .prepare("SELECT id, name, charge, per_kg_charge AS perKgCharge FROM delivery_zones WHERE id = ? AND active = 1")
    .bind(id)
    .first<DeliveryZone>();
}

export interface NewOrder {
  id: string;
  reference: string;
  idempotencyKey: string;
  payloadHash: string;
  input: CheckoutInput;
  zone: DeliveryZone;
  deliveryCharge?: number;
  totalWeightG?: number;
  lines: OrderLine[];
  /** The item total before the coupon (the sum of the line totals). */
  itemsTotal: number;
  /** The coupon this order claims a use of, with the discount taken off `itemsTotal`; null for none. */
  coupon: { id: number; code: string; discount: number } | null;
  /** The item total after the coupon, the revenue (orders.subtotal). */
  subtotal: number;
  total: number;
  itemCount: number;
  shopDay: string;
  createdAt: string;
}

/**
 * True when the coupon (the bound id, or NULL for none) is on, inside its dates and has a use left. Four parameters:
 * the coupon id twice, then the order time (ISO UTC, as the dates are stored) twice.
 */
const COUPON_USABLE = `(? IS NULL OR EXISTS (SELECT 1 FROM discounts
  WHERE id = ? AND kind = 'coupon' AND active = 1 AND (usage_limit IS NULL OR used_count < usage_limit)
    AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)))`;

/**
 * True when the phone (bound twice, then the cap) is not blocked and has fewer than the cap's orders still 'new'. It is
 * part of the order INSERT's WHERE, so two submits racing for the last open slot cannot both save, and a refused order
 * leaves nothing behind because every later statement needs the order row.
 */
const PHONE_ALLOWED = `NOT EXISTS (SELECT 1 FROM blocked_phones WHERE phone = ?)
  AND (SELECT COUNT(*) FROM orders WHERE phone = ? AND status = 'new') < ?`;

/** Takes one use, only while one is left and only for an order that exists and names this coupon (3 parameters). */
export const CLAIM_COUPON_USE_SQL = `UPDATE discounts SET used_count = used_count + 1
  WHERE id = ? AND (usage_limit IS NULL OR used_count < usage_limit)
    AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND coupon_id = ?)`;

/**
 * Saves the order, its lines, the first history row and the day's "received" count as one transaction, and takes the
 * counted colours out of stock. Returns false, with nothing saved, when a counted colour holds fewer than a line wants,
 * the coupon has no use left, the phone is blocked or the phone already has MAX_OPEN_ORDERS orders at 'new'.
 *
 * A coupon use is claimed in the same batch. The order INSERT is conditional on the coupon still being usable
 * (COUPON_USABLE: on, inside its dates, a use left) and the claim UPDATE follows it as the next statement of the same transaction, so two orders racing
 * for the last use cannot both save: the second finds the count at the limit, inserts nothing and every later
 * statement (which all need the order row) does nothing.
 *
 * The order INSERT is conditional (NO_SHORT_LINE), and every later statement runs only when the order row exists, so a
 * short colour saves nothing even if its stock changed after the caller read it. Throws D1's UNIQUE error for a reused
 * idempotency key or reference; the caller decides what that means.
 */
export async function insertOrder(db: D1Database, order: NewOrder): Promise<boolean> {
  const { input } = order;
  const orderExists = "EXISTS (SELECT 1 FROM orders WHERE id = ?)";
  const [placed] = await db.batch([
    db
      .prepare(
        `INSERT INTO orders (id, reference, idempotency_key, payload_hash, customer_name, phone, address, note,
           zone_id, zone_name, delivery_charge, total_weight_g, subtotal, total, item_count, shop_day, created_at, updated_at,
           items_total, coupon_code, coupon_id, coupon_discount)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${NO_SHORT_LINE} AND ${COUPON_USABLE} AND ${PHONE_ALLOWED}`,
      )
      .bind(
        order.id,
        order.reference,
        order.idempotencyKey,
        order.payloadHash,
        input.name,
        input.phone,
        input.address,
        input.note,
        order.zone.id,
        order.zone.name,
        order.deliveryCharge ?? order.zone.charge,
        order.totalWeightG ?? 0,
        order.subtotal,
        order.total,
        order.itemCount,
        order.shopDay,
        order.createdAt,
        order.createdAt,
        order.itemsTotal,
        order.coupon?.code ?? null,
        order.coupon?.id ?? null,
        order.coupon?.discount ?? 0,
        stockLinesJson(order.lines),
        order.coupon?.id ?? null,
        order.coupon?.id ?? null,
        order.createdAt,
        order.createdAt,
        input.phone,
        input.phone,
        MAX_OPEN_ORDERS,
      ),
    ...(order.coupon ? [db.prepare(CLAIM_COUPON_USE_SQL).bind(order.coupon.id, order.id, order.coupon.id)] : []),
    db
      .prepare(
        `INSERT INTO order_items (order_id, line, product_id, variant_position, product_name, variant_name,
           availability, unit_price, cost_price, qty, line_total, list_price, discount_id)
         SELECT ?, j.key, json_extract(j.value, '$.productId'), json_extract(j.value, '$.variant'),
           json_extract(j.value, '$.productName'), json_extract(j.value, '$.variantName'),
           json_extract(j.value, '$.availability'), json_extract(j.value, '$.unitPrice'),
           json_extract(j.value, '$.costPrice'), json_extract(j.value, '$.qty'),
           json_extract(j.value, '$.unitPrice') * json_extract(j.value, '$.qty'),
           json_extract(j.value, '$.listPrice'), json_extract(j.value, '$.discountId')
         FROM json_each(?) j WHERE ${orderExists}`,
      )
      .bind(
        order.id,
        JSON.stringify(
          order.lines.map((line) => ({
            productId: line.productId,
            variant: line.variant,
            productName: line.productName,
            variantName: line.variantName,
            availability: line.availability,
            unitPrice: line.unitPrice,
            costPrice: line.costPrice,
            qty: line.qty,
            listPrice: line.listPrice,
            discountId: line.discountId,
          })),
        ),
        order.id,
      ),
    db
      .prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, from_payment_status, to_payment_status,
           actor_username, created_at)
         SELECT ?, NULL, 'new', NULL, 'unpaid', NULL, ? WHERE ${orderExists}`,
      )
      .bind(order.id, order.createdAt, order.id),
    db
      .prepare(
        `INSERT INTO daily_totals (shop_day, orders_received) SELECT ?, 1 WHERE ${orderExists}
         ON CONFLICT (shop_day) DO UPDATE SET orders_received = orders_received + 1`,
      )
      .bind(order.shopDay, order.id),
    // The Telegram alert is queued with the order, so it can never be lost (unit 8).
    db
      .prepare(
        `INSERT INTO order_notification_outbox (order_id, next_attempt_at, created_at, updated_at)
         SELECT ?, ?, ?, ? WHERE ${orderExists}`,
      )
      .bind(order.id, Date.parse(order.createdAt), order.createdAt, order.createdAt, order.id),
    ...reserveStockStatements(db, order.id, order.lines, order.createdAt),
  ]);
  return placed?.meta.changes === 1;
}

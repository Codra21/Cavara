// Guest order writes and lookups. Server-only. Every query is a primary-key or indexed lookup (D1 read budget).
import type { CheckoutInput, DeliveryZone } from "@/domain/orders";
import type { Availability } from "@/lib/types";
import type { D1Database } from "./d1";

export interface OrderReplay {
  reference: string;
  payload_hash: string;
  total: number;
}

export async function findOrderByIdempotencyKey(db: D1Database, key: string): Promise<OrderReplay | null> {
  return db
    .prepare("SELECT reference, payload_hash, total FROM orders WHERE idempotency_key = ?")
    .bind(key)
    .first<OrderReplay>();
}

/**
 * Counts this attempt against every key, then reports whether all are within their limits.
 * Runs before the catalogue lookups, so a flood of bad requests is cut off cheaply.
 */
export async function consumeOrderLimits(
  db: D1Database,
  limits: { key: string; max: number }[],
  now: number,
  windowMs: number,
): Promise<boolean> {
  const expires = now + windowMs;
  const results = await db.batch<{ attempts: number }>([
    db.prepare("DELETE FROM order_rate_limits WHERE expires_at <= ?").bind(now),
    ...limits.map(({ key }) =>
      db
        .prepare(
          `INSERT INTO order_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
           ON CONFLICT (key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`,
        )
        .bind(key, expires),
    ),
  ]);
  return limits.every((limit, index) => (results[index + 1]?.results[0]?.attempts ?? Infinity) <= limit.max);
}

export interface Selection {
  productId: number;
  variant: number;
  productName: string;
  variantName: string;
  status: string;
  availability: Availability;
  unitPrice: number;
  costPrice: number | null;
}

/** Current product and colour data for each bag line, by primary key and UNIQUE (product_id, position). */
export async function readSelections(db: D1Database, items: CheckoutInput["items"]): Promise<Map<string, Selection>> {
  const { results } = await db
    .prepare(
      `SELECT v.product_id AS productId, v.position AS variant, p.name AS productName, v.name AS variantName,
         p.status, v.availability, p.price AS unitPrice, p.cost_price AS costPrice
       FROM json_each(?) j
       JOIN product_variants v
         ON v.product_id = json_extract(j.value, '$[0]') AND v.position = json_extract(j.value, '$[1]')
       JOIN products p ON p.id = v.product_id`,
    )
    .bind(JSON.stringify(items.map((item) => [item.productId, item.variant])))
    .all<Selection>();
  return new Map(results.map((row) => [`${row.productId}:${row.variant}`, row]));
}

export async function readActiveZone(db: D1Database, id: string): Promise<DeliveryZone | null> {
  return db
    .prepare("SELECT id, name, charge FROM delivery_zones WHERE id = ? AND active = 1")
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
  lines: (Selection & { qty: number })[];
  subtotal: number;
  total: number;
  itemCount: number;
  shopDay: string;
  createdAt: string;
}

/**
 * Saves the order, its lines, the first history row and the day's "received" count as one transaction.
 * Throws D1's UNIQUE error for a reused idempotency key or reference; the caller decides what that means.
 */
export async function insertOrder(db: D1Database, order: NewOrder): Promise<void> {
  const { input } = order;
  await db.batch([
    db
      .prepare(
        `INSERT INTO orders (id, reference, idempotency_key, payload_hash, customer_name, phone, address, note,
           zone_id, zone_name, delivery_charge, subtotal, total, item_count, shop_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        order.zone.charge,
        order.subtotal,
        order.total,
        order.itemCount,
        order.shopDay,
        order.createdAt,
        order.createdAt,
      ),
    db
      .prepare(
        `INSERT INTO order_items (order_id, line, product_id, variant_position, product_name, variant_name,
           availability, unit_price, cost_price, qty, line_total)
         SELECT ?, j.key, json_extract(j.value, '$.productId'), json_extract(j.value, '$.variant'),
           json_extract(j.value, '$.productName'), json_extract(j.value, '$.variantName'),
           json_extract(j.value, '$.availability'), json_extract(j.value, '$.unitPrice'),
           json_extract(j.value, '$.costPrice'), json_extract(j.value, '$.qty'),
           json_extract(j.value, '$.unitPrice') * json_extract(j.value, '$.qty')
         FROM json_each(?) j`,
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
          })),
        ),
      ),
    db
      .prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, from_payment_status, to_payment_status,
           actor_username, created_at)
         VALUES (?, NULL, 'new', NULL, 'unpaid', NULL, ?)`,
      )
      .bind(order.id, order.createdAt),
    db
      .prepare(
        `INSERT INTO daily_totals (shop_day, orders_received) VALUES (?, 1)
         ON CONFLICT (shop_day) DO UPDATE SET orders_received = orders_received + 1`,
      )
      .bind(order.shopDay),
  ]);
}

export async function listActiveZones(db: D1Database): Promise<DeliveryZone[]> {
  const { results } = await db
    .prepare("SELECT id, name, charge, sort FROM delivery_zones WHERE active = 1")
    .all<DeliveryZone & { sort: number }>();
  return results
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map(({ id, name, charge }) => ({ id, name, charge }));
}

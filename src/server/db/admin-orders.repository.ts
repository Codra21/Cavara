// Admin order inbox, status changes and delivery zones. Server-only; callers have passed the auth middleware.
// Every list is keyset-paginated on an index and every lookup is by key (code-standards: D1 read budget).
//
// A status change is one batch. The first statement claims the order (`WHERE id = ? AND version = ?`) and sets a
// fresh change_token; the history row, the day's sales totals and the audit row are guarded on that token, so a
// stale or concurrent change writes nothing at all. The caller checks the first result's meta.changes.
import type { AdminIdentity, AuditValue } from "@/domain/admin";
import {
  type AdminOrderDetail,
  type AdminOrderEvent,
  type AdminOrderLine,
  type AdminOrderPage,
  type AdminOrderSummary,
  type AdminZone,
  canChangeStatus,
  isSold,
  ORDER_PAGE_SIZE,
  type OrderListQuery,
  orderListSchema,
  type OrderStatus,
  orderSales,
  parseOrderSearch,
  type PaymentStatus,
  STATUS_LABELS,
  type UpdateOrderInput,
  type UpdateOrderResult,
  type ZoneInput,
} from "@/domain/orders";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

interface OrderRow {
  id: string;
  reference: string;
  customer_name: string;
  phone: string;
  zone_name: string;
  total: number;
  item_count: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  created_at: string;
}

const SUMMARY_COLUMNS =
  "id, reference, customer_name, phone, zone_name, total, item_count, status, payment_status, created_at";

const toSummary = (row: OrderRow): AdminOrderSummary => ({
  id: row.id,
  reference: row.reference,
  customerName: row.customer_name,
  phone: row.phone,
  zoneName: row.zone_name,
  total: row.total,
  itemCount: row.item_count,
  status: row.status,
  paymentStatus: row.payment_status,
  createdAt: row.created_at,
});

/** Newest first, 50 per page. Status filter, phone and reference searches each use their own index. */
export async function listOrders(db: D1Database, raw: OrderListQuery = {}): Promise<AdminOrderPage> {
  const query = orderListSchema.parse(raw);
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    const search = parseOrderSearch(query.search);
    if (!search) return { orders: [], next: null };
    if ("reference" in search) {
      const row = await db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM orders WHERE reference = ?`)
        .bind(search.reference)
        .first<OrderRow>();
      return {
        orders: row && (query.status === "all" || row.status === query.status) ? [toSummary(row)] : [],
        next: null,
      };
    }
    where.push("phone = ?");
    params.push(search.phone);
  }
  if (query.status !== "all") {
    where.push("status = ?");
    params.push(query.status);
  }
  if (query.after) {
    where.push("(created_at, id) < (?, ?)");
    params.push(query.after.createdAt, query.after.id);
  }

  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...params, ORDER_PAGE_SIZE + 1)
    .all<OrderRow>();
  const page = results.slice(0, ORDER_PAGE_SIZE).map(toSummary);
  const last = page.at(-1);
  return {
    orders: page,
    next: results.length > ORDER_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

interface DetailRow extends OrderRow {
  address: string;
  note: string;
  zone_id: string;
  delivery_charge: number;
  subtotal: number;
  version: number;
  shop_day: string;
}

export async function getOrder(db: D1Database, id: string): Promise<AdminOrderDetail | null> {
  const [orderResult, lineResult, historyResult] = await db.batch([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, address, note, zone_id, delivery_charge, subtotal, version, shop_day
         FROM orders WHERE id = ?`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT line, product_id AS productId, variant_position AS variantPosition, product_name AS productName,
           variant_name AS variantName, availability, unit_price AS unitPrice, cost_price AS costPrice, qty,
           line_total AS lineTotal
         FROM order_items WHERE order_id = ? ORDER BY line`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT id, from_status AS fromStatus, to_status AS toStatus, from_payment_status AS fromPaymentStatus,
           to_payment_status AS toPaymentStatus, actor_username AS actorUsername, note, created_at AS createdAt
         FROM order_status_history WHERE order_id = ? ORDER BY id`,
      )
      .bind(id),
  ]);
  const row = (orderResult?.results ?? [])[0] as DetailRow | undefined;
  if (!row) return null;
  return {
    ...toSummary(row),
    address: row.address,
    note: row.note,
    zoneId: row.zone_id,
    deliveryCharge: row.delivery_charge,
    subtotal: row.subtotal,
    version: row.version,
    shopDay: row.shop_day,
    lines: (lineResult?.results ?? []) as AdminOrderLine[],
    history: (historyResult?.results ?? []) as AdminOrderEvent[],
  };
}

const TIMESTAMP_COLUMN: Partial<Record<OrderStatus, string>> = {
  confirmed: "confirmed_at",
  dispatched: "dispatched_at",
  delivered: "delivered_at",
  cancelled: "cancelled_at",
};

export async function updateOrderStatus(
  db: D1Database,
  actor: AdminIdentity,
  input: UpdateOrderInput,
  now = new Date(),
): Promise<UpdateOrderResult> {
  const current = await getOrder(db, input.id);
  if (!current) return { ok: false, error: "This order no longer exists." };
  if (current.version !== input.version) {
    return { ok: false, conflict: true, error: "This order changed since you opened it. Reload to see the latest." };
  }
  if (!canChangeStatus(current.status, input.status)) {
    return {
      ok: false,
      error: `A ${STATUS_LABELS[current.status].toLowerCase()} order cannot become ${STATUS_LABELS[input.status].toLowerCase()}.`,
    };
  }
  const statusChanged = current.status !== input.status;
  const paymentChanged = current.paymentStatus !== input.paymentStatus;
  if (!statusChanged && !paymentChanged && !input.note) return { ok: true, version: current.version };

  const at = now.toISOString();
  const token = crypto.randomUUID();
  const guardSql = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND change_token = ?)";
  const guardParams = [input.id, token];
  const stamp = statusChanged ? TIMESTAMP_COLUMN[input.status] : undefined;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE orders SET status = ?, payment_status = ?, version = version + 1, change_token = ?, updated_at = ?
           ${stamp ? `, ${stamp} = ?` : ""}
         WHERE id = ? AND version = ?`,
      )
      .bind(input.status, input.paymentStatus, token, at, ...(stamp ? [at] : []), input.id, input.version),
    db
      .prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, from_payment_status, to_payment_status,
           actor_username, note, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql}`,
      )
      .bind(
        input.id,
        current.status,
        input.status,
        current.paymentStatus,
        input.paymentStatus,
        actor.username,
        input.note,
        at,
        ...guardParams,
      ),
  ];

  // Entering or leaving the "sold" set moves this order's revenue and profit on the day it was placed.
  const soldDelta = Number(isSold(input.status)) - Number(isSold(current.status));
  if (soldDelta !== 0) {
    const sales = orderSales(current.lines, current.subtotal);
    statements.push(
      db
        .prepare(
          `INSERT INTO daily_totals (shop_day, orders_sold, revenue, profit, lines_without_cost)
           SELECT ?, ?, ?, ?, ? WHERE ${guardSql}
           ON CONFLICT (shop_day) DO UPDATE SET
             orders_sold = orders_sold + excluded.orders_sold,
             revenue = revenue + excluded.revenue,
             profit = profit + excluded.profit,
             lines_without_cost = lines_without_cost + excluded.lines_without_cost`,
        )
        .bind(
          current.shopDay,
          soldDelta,
          soldDelta * sales.revenue,
          soldDelta * sales.profit,
          soldDelta * sales.linesWithoutCost,
          ...guardParams,
        ),
    );
  }

  const details: Record<string, AuditValue> = {
    reference: current.reference,
    status: input.status,
    payment: input.paymentStatus,
  };
  statements.push(
    auditStatement(db, actor, "order.updated", input.id, details, now, { sql: guardSql, params: guardParams }),
  );

  const [claim] = await db.batch(statements);
  if (claim?.meta.changes !== 1) {
    return { ok: false, conflict: true, error: "This order changed since you opened it. Reload to see the latest." };
  }
  return { ok: true, version: current.version + 1 };
}

// Delivery zones -------------------------------------------------------------------------------------------------

export async function listZones(db: D1Database): Promise<AdminZone[]> {
  const { results } = await db
    .prepare("SELECT id, name, charge, active, sort FROM delivery_zones")
    .all<{ id: string; name: string; charge: number; active: number; sort: number }>();
  return results
    .map((row) => ({ ...row, active: row.active === 1 }))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

function zoneId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "area";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export type SaveZonesResult = { ok: true; zones: AdminZone[] } | { ok: false; error: string };

/**
 * Saves the whole list in its new order. Zones are never deleted, because orders keep their zone id; switching
 * `active` off hides one from checkout. Existing orders keep the charge they were placed with.
 */
export async function saveZones(
  db: D1Database,
  actor: AdminIdentity,
  zones: ZoneInput[],
  now = new Date(),
): Promise<SaveZonesResult> {
  const existing = await listZones(db);
  const known = new Set(existing.map((zone) => zone.id));
  if (zones.some((zone) => zone.id !== null && !known.has(zone.id))) {
    return { ok: false, error: "A delivery area changed in another tab. Reload and try again." };
  }
  const missing = existing.filter((zone) => !zones.some((input) => input.id === zone.id));
  if (missing.length) return { ok: false, error: "Delivery areas cannot be removed; switch one off instead." };

  const taken = new Set(known);
  const at = now.toISOString();
  const rows = zones.map((zone, sort) => ({ ...zone, id: zone.id ?? zoneId(zone.name, taken), sort }));
  await db.batch([
    ...rows.map((zone) =>
      db
        .prepare(
          `INSERT INTO delivery_zones (id, name, charge, active, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, charge = excluded.charge, active = excluded.active,
             sort = excluded.sort, updated_at = excluded.updated_at`,
        )
        .bind(zone.id, zone.name, zone.charge, zone.active ? 1 : 0, zone.sort, at),
    ),
    auditStatement(
      db,
      actor,
      "zones.updated",
      "delivery_zones",
      { areas: rows.map((zone) => `${zone.name} ${zone.charge}${zone.active ? "" : " (off)"}`).join(", ") },
      now,
    ),
  ]);
  return { ok: true, zones: await listZones(db) };
}

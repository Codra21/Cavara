import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  couponAmount,
  type CouponRule,
  couponInputSchema,
  couponState,
  evaluateCoupon,
  normalizeCouponCode,
} from "@/domain/coupons";
import { type CheckoutRequest, ORDER_LIMITS } from "@/domain/orders";
import { listAudit } from "@/server/admin/auth.server";
import { LIST_COUPONS_SQL, listCoupons, saveCoupon } from "@/server/db/admin-coupons.repository";
import { updateOrderStatus, getOrder } from "@/server/db/admin-orders.repository";
import { CLAIM_COUPON_USE_SQL, COUPON_BY_CODE_SQL } from "@/server/db/orders.repository";
import { checkCoupon } from "@/server/services/coupons.service";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const NOW = Date.parse("2026-11-15T06:00:00.000Z");
const T0 = new Date(NOW);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = "x".repeat(40);

const rule = (over: Partial<CouponRule> = {}): CouponRule => ({
  id: 1,
  code: "SAVE10",
  type: "percent",
  value: 10,
  minOrder: null,
  maxDiscount: null,
  usageLimit: null,
  usedCount: 0,
  active: true,
  startsAt: iso(NOW - HOUR),
  endsAt: iso(NOW + HOUR),
  ...over,
});

describe("the coupon rule", () => {
  test("codes are trimmed and upper-cased; the format is 3 to 20 of A-Z, 0-9 and hyphen", () => {
    expect(normalizeCouponCode("  eid-25 ")).toBe("EID-25");
    for (const bad of ["ab", "A".repeat(21), "NO SPACES", "snow_man", "ঈদ25", ""])
      expect(normalizeCouponCode(bad)).toBeNull();
  });

  test("a percent coupon rounds down to whole taka, and the cap limits it", () => {
    expect(couponAmount(999, { type: "percent", value: 10, maxDiscount: null })).toBe(99);
    expect(couponAmount(5000, { type: "percent", value: 20, maxDiscount: 300 })).toBe(300);
    expect(couponAmount(1000, { type: "percent", value: 20, maxDiscount: 300 })).toBe(200);
    // The cap belongs to percent coupons; an amount coupon ignores it.
    expect(couponAmount(1000, { type: "amount", value: 400, maxDiscount: 100 })).toBe(400);
  });

  test("the order never drops below 1 taka", () => {
    expect(couponAmount(500, { type: "amount", value: 900, maxDiscount: null })).toBe(499);
    expect(couponAmount(1, { type: "amount", value: 50, maxDiscount: null })).toBe(0);
    expect(evaluateCoupon(rule({ type: "amount", value: 50 }), 1, NOW)).toMatchObject({
      ok: false,
      reason: "no_discount",
    });
  });

  test("minimum order is checked on the item total after sales", () => {
    const coupon = rule({ minOrder: 1000 });
    expect(evaluateCoupon(coupon, 999, NOW)).toMatchObject({ ok: false, reason: "min_order" });
    expect(evaluateCoupon(coupon, 1000, NOW)).toMatchObject({ ok: true, discount: 100, subtotal: 900 });
  });

  test("dates: starts inclusive, ends exclusive, open-ended", () => {
    expect(evaluateCoupon(rule({ startsAt: iso(NOW) }), 1000, NOW).ok).toBe(true);
    expect(evaluateCoupon(rule({ startsAt: iso(NOW + 1) }), 1000, NOW)).toMatchObject({ reason: "not_started" });
    expect(evaluateCoupon(rule({ endsAt: iso(NOW) }), 1000, NOW)).toMatchObject({ reason: "expired" });
    expect(evaluateCoupon(rule({ endsAt: iso(NOW + 1) }), 1000, NOW).ok).toBe(true);
    expect(evaluateCoupon(rule({ endsAt: null }), 1000, NOW + 400 * 24 * HOUR).ok).toBe(true);
  });

  test("usage limit, unknown and switched-off codes", () => {
    expect(evaluateCoupon(rule({ usageLimit: 3, usedCount: 2 }), 1000, NOW).ok).toBe(true);
    expect(evaluateCoupon(rule({ usageLimit: 3, usedCount: 3 }), 1000, NOW)).toMatchObject({ reason: "used_up" });
    expect(evaluateCoupon(null, 1000, NOW)).toMatchObject({ reason: "unknown" });
    // A switched-off coupon reads as unknown, so a dead code reveals nothing.
    expect(evaluateCoupon(rule({ active: false }), 1000, NOW)).toMatchObject({ reason: "unknown" });
  });

  test("the admin form: a percent coupon takes 1 to 99, the cap only stays on percent, dates must be ordered", () => {
    const base = {
      name: "Eid",
      code: " eid25 ",
      type: "percent",
      value: 25,
      minOrder: null,
      maxDiscount: 500,
      usageLimit: null,
      startsAt: iso(NOW),
      endsAt: iso(NOW + HOUR),
      active: true,
    };
    expect(couponInputSchema.parse(base)).toMatchObject({ code: "EID25", maxDiscount: 500 });
    expect(couponInputSchema.parse({ ...base, type: "amount", value: 100 }).maxDiscount).toBeNull();
    expect(couponInputSchema.safeParse({ ...base, value: 100 }).success).toBe(false);
    expect(couponInputSchema.safeParse({ ...base, code: "no" }).success).toBe(false);
    expect(couponInputSchema.safeParse({ ...base, endsAt: iso(NOW) }).success).toBe(false);
  });

  test("the list state follows switch, dates and use count", () => {
    const base = { active: true, startsAt: iso(NOW - HOUR), endsAt: null, usageLimit: 1, usedCount: 0 };
    expect(couponState(base, NOW)).toBe("live");
    expect(couponState({ ...base, usedCount: 1 }, NOW)).toBe("used_up");
    expect(couponState({ ...base, active: false }, NOW)).toBe("off");
    expect(couponState({ ...base, endsAt: iso(NOW - 1) }, NOW)).toBe("ended");
    expect(couponState({ ...base, startsAt: iso(NOW + 1) }, NOW)).toBe("upcoming");
  });
});

// ---------------------------------------------------------------------------------------------------------------

function addCoupon(db: TestD1, over: Partial<Record<string, unknown>> = {}): number {
  const row = {
    code: "SAVE10",
    type: "percent",
    value: 10,
    min_order: null,
    max_discount: null,
    usage_limit: null,
    used_count: 0,
    starts_at: iso(NOW - HOUR),
    ends_at: iso(NOW + HOUR),
    active: 1,
    ...over,
  };
  const result = db.sqlite
    .query(
      `INSERT INTO discounts (name, kind, scope, type, value, min_order, max_discount, usage_limit, used_count,
         starts_at, ends_at, active, created_at, updated_at, revision, code)
       VALUES ('Coupon', 'coupon', 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.type as string,
      row.value as number,
      row.min_order as number | null,
      row.max_discount as number | null,
      row.usage_limit as number | null,
      row.used_count as number,
      row.starts_at as string,
      row.ends_at as string | null,
      row.active as number,
      iso(NOW),
      iso(NOW),
      crypto.randomUUID(),
      row.code as string,
    );
  return Number(result.lastInsertRowid);
}

function addSale(db: TestD1, over: Partial<Record<string, unknown>> = {}) {
  const row = { type: "amount", value: 50, ...over };
  db.sqlite
    .query(
      `INSERT INTO discounts (name, kind, scope, type, value, starts_at, ends_at, active, created_at, updated_at, revision)
       VALUES ('Sale', 'sale', 'all', ?, ?, ?, NULL, 1, ?, ?, ?)`,
    )
    .run(row.type as string, row.value as number, iso(NOW - HOUR), iso(NOW), iso(NOW), crypto.randomUUID());
}

function pick(db: TestD1) {
  return db.sqlite
    .query(
      `SELECT p.id, p.price FROM products p
       JOIN product_variants v ON v.product_id = p.id AND v.position = 0 AND v.availability = 'in_stock'
       WHERE p.status = 'published' AND p.price >= 600 ORDER BY p.id LIMIT 1`,
    )
    .get() as { id: number; price: number };
}

let phoneCounter = 0;
function request(
  items: { productId: number; variant: number; qty: number; unitPrice: number }[],
  over: Partial<CheckoutRequest> = {},
): CheckoutRequest {
  phoneCounter += 1;
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "Test Customer",
    phone: `0171234${String(1000 + phoneCounter)}`,
    zoneId: "inside-dhaka",
    address: "House 1, Road 2, Dhanmondi, Dhaka",
    note: "",
    deliveryCharge: 80 + 20 * Math.max(0, items.reduce((sum, item) => sum + item.qty, 0) - 1),
    items,
    website: "",
    ...over,
  };
}

const submit = (db: TestD1, body: CheckoutRequest, at = T0, client = crypto.randomUUID()) =>
  submitOrder(db, body, { client, limitSecret: SECRET, now: at });

const row = <T>(db: TestD1, sql: string, ...params: (string | number)[]) => db.sqlite.query(sql).get(...params) as T;
const count = (db: TestD1, table: string) => row<{ n: number }>(db, `SELECT count(*) AS n FROM ${table}`).n;
const usedCount = (db: TestD1, id: number) =>
  row<{ used_count: number }>(db, "SELECT used_count FROM discounts WHERE id = ?", id).used_count;

describe("checkout with a coupon", () => {
  let db: TestD1;
  let product: { id: number; price: number };
  beforeEach(() => {
    db = createTestD1();
    product = pick(db);
  });

  test("charges the discount, stores the code, claims a use, and keeps total = subtotal + delivery", async () => {
    const coupon = addCoupon(db, { value: 10, usage_limit: 5 });
    const items = [{ productId: product.id, variant: 0, qty: 2, unitPrice: product.price }];
    const itemsTotal = product.price * 2;
    const discount = Math.floor(itemsTotal / 10);
    const result = await submit(db, request(items, { couponCode: " save10 ", couponDiscount: discount }));
    if (!result.ok) throw new Error(result.message);
    expect(result.total).toBe(itemsTotal - discount + 100);
    expect(row(db, "SELECT items_total, subtotal, total, coupon_code, coupon_id, coupon_discount FROM orders")).toEqual(
      {
        items_total: itemsTotal,
        subtotal: itemsTotal - discount,
        total: itemsTotal - discount + 100,
        coupon_code: "SAVE10",
        coupon_id: coupon,
        coupon_discount: discount,
      },
    );
    expect(usedCount(db, coupon)).toBe(1);
  });

  test("an order without a coupon records items_total = subtotal and no code", async () => {
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    expect((await submit(db, request(items))).ok).toBe(true);
    expect(row(db, "SELECT items_total, subtotal, coupon_code, coupon_id, coupon_discount FROM orders")).toEqual({
      items_total: product.price,
      subtotal: product.price,
      coupon_code: null,
      coupon_id: null,
      coupon_discount: 0,
    });
  });

  test("the minimum order is checked on the total after sales, and a refusal saves nothing", async () => {
    const coupon = addCoupon(db, { value: 10, min_order: product.price });
    addSale(db, { type: "amount", value: 50 });
    const charged = product.price - 50;
    const seen = await submit(
      db,
      request([{ productId: product.id, variant: 0, qty: 1, unitPrice: charged }], {
        couponCode: "SAVE10",
        couponDiscount: 50,
      }),
    );
    expect(seen).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: false, reason: "min_order" } });
    expect(count(db, "orders")).toBe(0);
    expect(usedCount(db, coupon)).toBe(0);
  });

  test("an expired, unknown or switched-off code returns price_changed with the one generic reason", async () => {
    addCoupon(db, { code: "OLD", ends_at: iso(NOW - 1), starts_at: iso(NOW - HOUR) });
    addCoupon(db, { code: "OFF", active: 0 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    for (const [code, reason] of [
      ["OLD", "unknown"],
      ["OFF", "unknown"],
      ["NOPE", "unknown"],
    ] as const) {
      const result = await submit(db, request(items, { couponCode: code, couponDiscount: 50 }));
      expect(result).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: false, reason } });
    }
    expect(count(db, "orders")).toBe(0);
  });

  test("a non-zero couponDiscount with an empty couponCode returns price_changed instead of charging full price", async () => {
    const result = await submit(
      db,
      request([{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }], {
        couponCode: "",
        couponDiscount: 200,
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "price_changed", coupon: null });
    expect(count(db, "orders")).toBe(0);
  });

  test("a discount different from the one the shopper saw is reported, then accepted", async () => {
    addCoupon(db, { value: 10 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const wrong = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: 1 }));
    const discount = Math.floor(product.price / 10);
    expect(wrong).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: true, discount } });
    const right = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }));
    expect(right.ok).toBe(true);
  });

  test("the cap limits a percent coupon at checkout", async () => {
    addCoupon(db, { value: 50, max_discount: 100 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const result = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: 100 }));
    expect(result.ok).toBe(true);
    expect(row(db, "SELECT coupon_discount, subtotal FROM orders")).toEqual({
      coupon_discount: 100,
      subtotal: product.price - 100,
    });
  });

  test("a coupon that would take the whole total still leaves 1 taka", async () => {
    addCoupon(db, { type: "amount", value: 1_000_000 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const result = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: product.price - 1 }));
    expect(result.ok).toBe(true);
    expect(row(db, "SELECT subtotal, total FROM orders")).toEqual({ subtotal: 1, total: 81 });
  });

  test("usage limit race: two orders for the last use, the second saves nothing and is told", async () => {
    const coupon = addCoupon(db, { usage_limit: 1 });
    db.sqlite.run("UPDATE product_variants SET stock = 10 WHERE product_id = ? AND position = 0", [product.id]);
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const discount = Math.floor(product.price / 10);
    const first = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }));
    expect(first.ok).toBe(true);

    // Both orders read the coupon while it had a use left; the second one's save happens after the first's.
    // Simulate that by putting the use count back for the read and taking it for the save.
    const second = request(items, { couponCode: "SAVE10", couponDiscount: discount });
    db.sqlite.run("UPDATE discounts SET used_count = 0 WHERE id = ?", [coupon]);
    const realPrepare = db.prepare.bind(db);
    let raced = false;
    db.prepare = (sql: string) => {
      // The moment the order batch starts, another order takes the last use.
      if (!raced && sql.startsWith("INSERT INTO orders")) {
        raced = true;
        db.sqlite.run("UPDATE discounts SET used_count = 1 WHERE id = ?", [coupon]);
      }
      return realPrepare(sql);
    };
    const lost = await submit(db, second);
    db.prepare = realPrepare;

    expect(lost).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: false, reason: "unknown" } });
    expect(count(db, "orders")).toBe(1);
    expect(count(db, "order_items")).toBe(1);
    expect(usedCount(db, coupon)).toBe(1);
    // The loser took no stock and wrote no history, day total or alert.
    expect(
      row<{ stock: number }>(db, "SELECT stock FROM product_variants WHERE product_id = ? AND position = 0", product.id)
        .stock,
    ).toBe(9);
    expect(count(db, "order_status_history")).toBe(1);
    expect(count(db, "order_notification_outbox")).toBe(1);
    expect(row(db, "SELECT orders_received FROM daily_totals")).toEqual({ orders_received: 1 });
  });

  test("with a limit of 1, a second order after the first is refused before it reaches the batch", async () => {
    const coupon = addCoupon(db, { usage_limit: 1 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const discount = Math.floor(product.price / 10);
    expect((await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }))).ok).toBe(true);
    const next = await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }));
    expect(next).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: false, reason: "unknown" } });
    expect(usedCount(db, coupon)).toBe(1);
    expect(count(db, "orders")).toBe(1);
  });

  test("replaying the same idempotency key returns the saved order and does not use the coupon again", async () => {
    const coupon = addCoupon(db, { usage_limit: 5 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const body = request(items, { couponCode: "SAVE10", couponDiscount: Math.floor(product.price / 10) });
    const first = await submit(db, body);
    const again = await submit(db, body);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && again.ok && first.reference === again.reference).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);
    expect(count(db, "orders")).toBe(1);
  });

  test("the coupon code is part of the idempotency payload: the same key with another code is refused", async () => {
    addCoupon(db);
    addCoupon(db, { code: "OTHER" });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const discount = Math.floor(product.price / 10);
    const body = request(items, { couponCode: "SAVE10", couponDiscount: discount });
    expect((await submit(db, body)).ok).toBe(true);
    const swapped = await submit(db, { ...body, couponCode: "OTHER" });
    expect(swapped).toMatchObject({ ok: false, code: "idempotency_conflict" });
    const dropped = await submit(db, { ...body, couponCode: "", couponDiscount: 0 });
    expect(dropped).toMatchObject({ ok: false, code: "idempotency_conflict" });
  });

  test("coupon, sale and counted stock together in one order", async () => {
    const coupon = addCoupon(db, { value: 10, min_order: 500 });
    addSale(db, { type: "amount", value: 50 });
    db.sqlite.run("UPDATE product_variants SET stock = 5 WHERE product_id = ? AND position = 0", [product.id]);
    const charged = product.price - 50;
    const itemsTotal = charged * 3;
    const discount = Math.floor(itemsTotal / 10);
    const result = await submit(
      db,
      request([{ productId: product.id, variant: 0, qty: 3, unitPrice: charged }], {
        couponCode: "SAVE10",
        couponDiscount: discount,
      }),
    );
    if (!result.ok) throw new Error(result.message);
    expect(row(db, "SELECT items_total, subtotal, coupon_discount FROM orders")).toEqual({
      items_total: itemsTotal,
      subtotal: itemsTotal - discount,
      coupon_discount: discount,
    });
    expect(row(db, "SELECT unit_price, list_price FROM order_items")).toEqual({
      unit_price: charged,
      list_price: product.price,
    });
    expect(
      row<{ stock: number }>(db, "SELECT stock FROM product_variants WHERE product_id = ? AND position = 0", product.id)
        .stock,
    ).toBe(2);
    expect(usedCount(db, coupon)).toBe(1);
  });

  test("a short colour with a coupon saves nothing and does not use the coupon", async () => {
    const coupon = addCoupon(db, { usage_limit: 3 });
    db.sqlite.run("UPDATE product_variants SET stock = 1 WHERE product_id = ? AND position = 0", [product.id]);
    const items = [{ productId: product.id, variant: 0, qty: 2, unitPrice: product.price }];
    const result = await submit(
      db,
      request(items, { couponCode: "SAVE10", couponDiscount: Math.floor((product.price * 2) / 10) }),
    );
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(usedCount(db, coupon)).toBe(0);
    expect(count(db, "orders")).toBe(0);
  });

  test("daily totals: revenue is the subtotal after the coupon and profit loses the discount; cancel takes both back", async () => {
    addCoupon(db, { value: 10 });
    db.sqlite.run("UPDATE products SET cost_price = 100 WHERE id = ?", [product.id]);
    const items = [{ productId: product.id, variant: 0, qty: 2, unitPrice: product.price }];
    const itemsTotal = product.price * 2;
    const discount = Math.floor(itemsTotal / 10);
    expect((await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }))).ok).toBe(true);
    const id = row<{ id: string }>(db, "SELECT id FROM orders").id;

    const step = (version: number, status: "confirmed" | "cancelled") =>
      updateOrderStatus(db, owner, { id, version, status, paymentStatus: "unpaid", note: "" }, T0);
    expect((await step(1, "confirmed")).ok).toBe(true);
    expect(row(db, "SELECT revenue, profit, orders_sold FROM daily_totals")).toEqual({
      revenue: itemsTotal - discount,
      profit: (product.price - 100) * 2 - discount,
      orders_sold: 1,
    });

    const detail = await getOrder(db, id);
    expect(detail).toMatchObject({
      itemsTotal,
      subtotal: itemsTotal - discount,
      couponCode: "SAVE10",
      couponDiscount: discount,
    });

    // Cancelling takes the sale back out, with the discount, so the day nets to zero. The order was unpaid, so the cancel gives the coupon use back.
    expect((await step(2, "cancelled")).ok).toBe(true);
    expect(row(db, "SELECT revenue, profit, orders_sold FROM daily_totals")).toEqual({
      revenue: 0,
      profit: 0,
      orders_sold: 0,
    });
    expect(usedCount(db, row<{ id: number }>(db, "SELECT id FROM discounts WHERE kind = 'coupon'").id)).toBe(0);
  });

  test("orders from before coupons read back with items_total = subtotal", async () => {
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    expect((await submit(db, request(items))).ok).toBe(true);
    const id = row<{ id: string }>(db, "SELECT id FROM orders").id;
    db.sqlite.run("UPDATE orders SET items_total = NULL, coupon_code = NULL WHERE id = ?", [id]);
    expect(await getOrder(db, id)).toMatchObject({ itemsTotal: product.price, couponCode: null, couponDiscount: 0 });
  });

  test("the CHECK constraints hold", () => {
    const insert = (subtotal: number, total: number, itemsTotal: number | null, discount: number) =>
      db.sqlite
        .query(
          `INSERT INTO orders (id, reference, idempotency_key, payload_hash, customer_name, phone, address, zone_id,
             zone_name, delivery_charge, subtotal, total, item_count, shop_day, created_at, updated_at, items_total,
             coupon_discount)
           VALUES (?, ?, ?, 'h', 'Test Customer', '01712345678', 'House 1, Road 2, Dhaka', 'inside-dhaka',
             'Inside Dhaka', 80, ?, ?, 1, '2026-11-15', 'x', 'x', ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          `CV-${Math.random().toString(36).slice(2, 8)}`,
          crypto.randomUUID(),
          subtotal,
          total,
          itemsTotal,
          discount,
        );
    expect(() => insert(900, 980, 1000, 100)).not.toThrow();
    expect(() => insert(900, 981, 1000, 100)).toThrow(/CHECK/); // total = subtotal + delivery
    expect(() => insert(900, 980, 1000, 99)).toThrow(/CHECK/); // items_total - discount = subtotal
    expect(() => insert(0, 80, 100, 100)).toThrow(/CHECK/); // subtotal > 0
    expect(() => insert(1000, 1080, 1000, -0)).not.toThrow();
    expect(() => insert(1100, 1180, 1000, -100)).toThrow(/CHECK/); // discount >= 0
    expect(() => insert(1000, 1080, null, 0)).not.toThrow(); // a pre-coupon order
  });
});

describe("the code check", () => {
  let db: TestD1;
  let product: { id: number; price: number };
  beforeEach(() => {
    db = createTestD1();
    product = pick(db);
  });
  const check = (code: string, qty = 1, client = "203.0.113.7", at = T0) =>
    checkCoupon(
      db,
      { code, items: [{ productId: product.id, variant: 0, qty }] },
      { client, limitSecret: SECRET, now: at },
    );

  test("answers the discount for the bag, after sales", async () => {
    addCoupon(db, { value: 10 });
    addSale(db, { type: "amount", value: 50 });
    const itemsTotal = (product.price - 50) * 2;
    expect(await check(" save10 ", 2)).toEqual({
      ok: true,
      code: "SAVE10",
      discount: Math.floor(itemsTotal / 10),
      itemsTotal,
      subtotal: itemsTotal - Math.floor(itemsTotal / 10),
    });
  });

  test("ignores out-of-stock items when computing itemsTotal and minOrder", async () => {
    addCoupon(db, { code: "MIN500", min_order: 500 });
    db.sqlite.query("UPDATE product_variants SET availability = 'out_of_stock' WHERE product_id = ?").run(product.id);
    expect(await check("MIN500", 2)).toMatchObject({ ok: false, reason: "min_order" });
  });

  test("says why a code does not apply", async () => {
    addCoupon(db, { code: "BIG", min_order: 1_000_000 });
    addCoupon(db, { code: "GONE", usage_limit: 1, used_count: 1 });
    expect(await check("BIG")).toMatchObject({ ok: false, reason: "min_order" });
    expect(await check("GONE")).toMatchObject({ ok: false, reason: "unknown" });
    expect(await check("nothing")).toMatchObject({ ok: false, reason: "unknown" });
    expect(await check("no")).toMatchObject({ ok: false, reason: "unknown" });
    expect(await check("SAVE10", 1, "203.0.113.7", new Date(NOW))).toMatchObject({ ok: false, reason: "unknown" });
  });

  test("rate limits guessing per client under its own key, and the keys are HMACs", async () => {
    for (let attempt = 0; attempt < ORDER_LIMITS.couponIp; attempt++) {
      expect(await check(`GUESS${attempt}`)).toMatchObject({ reason: "unknown" });
    }
    expect(await check("GUESS99")).toMatchObject({ ok: false, reason: "rate_limited" });
    // Another client has its own budget, and order submissions keep theirs.
    expect(await check("GUESS99", 1, "198.51.100.2")).toMatchObject({ reason: "unknown" });
    const keys = JSON.stringify(db.sqlite.query("SELECT key FROM order_rate_limits").all());
    expect(keys).not.toContain("203.0.113.7");
    // The window passes and the budget returns.
    expect(await check("GUESS99", 1, "203.0.113.7", new Date(NOW + 16 * 60_000))).toMatchObject({ reason: "unknown" });
  });

  test("a malformed body is refused without touching the rate limit", async () => {
    expect(await checkCoupon(db, { code: 5 }, { client: "a", limitSecret: SECRET, now: T0 })).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(count(db, "order_rate_limits")).toBe(0);
  });

  test("query plans use the indexes", () => {
    const plan = (sql: string, ...params: (string | number)[]) =>
      (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
        .map((r) => r.detail)
        .join(" | ");
    const byCode = plan(COUPON_BY_CODE_SQL, "SAVE10");
    expect(byCode).toMatch(/SEARCH discounts USING INDEX sqlite_autoindex_discounts_1/);
    expect(byCode).not.toMatch(/SCAN|TEMP B-TREE/);
    const list = plan(LIST_COUPONS_SQL);
    expect(list).toMatch(/SCAN discounts USING INDEX idx_discounts_admin_coupons/);
    expect(list).not.toMatch(/TEMP B-TREE/);
    const claim = plan(CLAIM_COUPON_USE_SQL, 1, "x", 1);
    expect(claim).toMatch(/SEARCH discounts USING INTEGER PRIMARY KEY/);
    expect(claim).toMatch(
      /SEARCH orders USING (INDEX|PRIMARY KEY|COVERING INDEX) sqlite_autoindex_orders_1|SEARCH orders USING/,
    );
    console.log("coupon plans:", { byCode, list, claim });
  });
});

describe("admin coupons", () => {
  const input = (over: object = {}) =>
    couponInputSchema.parse({
      name: "Eid coupon",
      code: "eid25",
      type: "percent",
      value: 25,
      minOrder: 1000,
      maxDiscount: 500,
      usageLimit: 50,
      startsAt: iso(NOW),
      endsAt: iso(NOW + HOUR),
      active: true,
      ...over,
    });

  test("create, list, edit, switch off, with an audit row for each", async () => {
    const db = createTestD1();
    const created = await saveCoupon(db, owner, { id: null, revision: "", input: input() }, T0);
    if (!created.ok) throw new Error(created.error);
    expect(created.coupon).toMatchObject({ code: "EID25", usedCount: 0, usageLimit: 50, maxDiscount: 500 });
    expect((await listCoupons(db)).map((c) => c.code)).toEqual(["EID25"]);

    const off = await saveCoupon(
      db,
      owner,
      { id: created.coupon.id, revision: created.coupon.revision, input: input({ active: false }) },
      T0,
    );
    expect(off).toMatchObject({ ok: true, coupon: { active: false } });
    // A stale revision conflicts and changes nothing.
    const stale = await saveCoupon(
      db,
      owner,
      { id: created.coupon.id, revision: created.coupon.revision, input: input({ name: "Stale" }) },
      T0,
    );
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((await listCoupons(db))[0]).toMatchObject({ name: "Eid coupon", active: false });
    const actions = (await listAudit(db)).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["coupon.created", "coupon.updated"]));
  });

  test("a code is unique, and a saved coupon keeps its code and its use count", async () => {
    const db = createTestD1();
    const first = await saveCoupon(db, owner, { id: null, revision: "", input: input() }, T0);
    if (!first.ok) throw new Error(first.error);
    expect(await saveCoupon(db, owner, { id: null, revision: "", input: input({ name: "Again" }) }, T0)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already uses that code"),
    });
    expect(count(db, "discounts")).toBe(1);
    db.sqlite.run("UPDATE discounts SET used_count = 7 WHERE id = ?", [first.coupon.id]);
    const renamed = await saveCoupon(
      db,
      owner,
      { id: first.coupon.id, revision: first.coupon.revision, input: input({ code: "NEWCODE" }) },
      T0,
    );
    expect(renamed).toMatchObject({ ok: false, error: expect.stringContaining("cannot change") });
    const edited = await saveCoupon(
      db,
      owner,
      { id: first.coupon.id, revision: first.coupon.revision, input: input({ value: 30 }) },
      T0,
    );
    expect(edited).toMatchObject({ ok: true, coupon: { value: 30, usedCount: 7 } });
  });

  test("coupons stay out of the sales list and the live-sales read", async () => {
    const db = createTestD1();
    await saveCoupon(db, owner, { id: null, revision: "", input: input() }, T0);
    const { listDiscounts } = await import("@/server/db/admin-discounts.repository");
    const { readLiveSales } = await import("@/server/db/catalog.repository");
    expect(await listDiscounts(db)).toEqual([]);
    expect(await readLiveSales(db, T0)).toEqual([]);
  });
});

describe("one answer for every code a stranger could probe", () => {
  let db: TestD1;
  let product: { id: number; price: number };
  beforeEach(() => {
    db = createTestD1();
    product = pick(db);
  });
  const check = (code: string, client = "203.0.113.7", at = T0) =>
    checkCoupon(
      db,
      { code, items: [{ productId: product.id, variant: 0, qty: 1 }] },
      { client, limitSecret: SECRET, now: at },
    );

  test("unknown, switched off, expired, not started and used up read the same", async () => {
    addCoupon(db, { code: "OFF", active: 0 });
    addCoupon(db, { code: "OLD", starts_at: iso(NOW - 2 * HOUR), ends_at: iso(NOW - HOUR) });
    addCoupon(db, { code: "SOON", starts_at: iso(NOW + HOUR), ends_at: iso(NOW + 2 * HOUR) });
    addCoupon(db, { code: "GONE", usage_limit: 1, used_count: 1 });
    const answers = [];
    for (const code of ["NOPE1", "OFF", "OLD", "SOON", "GONE"]) answers.push(await check(code));
    for (const answer of answers) expect(answer).toEqual(answers[0]!);
    expect(answers[0]).toEqual({ ok: false, reason: "unknown", message: "This code isn't valid right now." });
  });

  test("the minimum order stays explained, because the shopper can act on it", async () => {
    addCoupon(db, { code: "BIG", min_order: 1_000_000 });
    expect(await check("BIG")).toMatchObject({
      ok: false,
      reason: "min_order",
      message: expect.stringContaining("at least"),
    });
  });

  test("an IPv6 client cannot dodge the limit by changing the last 64 bits", async () => {
    for (let attempt = 0; attempt < ORDER_LIMITS.couponIp; attempt++) {
      expect(await check(`GUESS${attempt}`, `2001:db8:5:6:${attempt + 1}::${attempt + 7}`)).toMatchObject({
        reason: "unknown",
      });
    }
    expect(await check("GUESS99", "2001:db8:5:6:abcd:1:2:3")).toMatchObject({ ok: false, reason: "rate_limited" });
    // Another /64 has its own budget, and the IPv4-mapped form counts as the IPv4 address.
    expect(await check("GUESS99", "2001:db8:5:7::1")).toMatchObject({ reason: "unknown" });
    expect(await check("GUESS99", "::ffff:198.51.100.9")).toMatchObject({ reason: "unknown" });
    expect(await check("GUESS99", "198.51.100.9")).toMatchObject({ reason: "unknown" });
    expect(count(db, "order_rate_limits")).toBe(3);
  });

  test("calls past the limit write nothing", async () => {
    for (let attempt = 0; attempt < ORDER_LIMITS.couponIp; attempt++) await check(`GUESS${attempt}`);
    const total = () => (db.sqlite.query("SELECT total_changes() AS n").get() as { n: number }).n;
    const before = total();
    for (let attempt = 0; attempt < 100; attempt++) {
      expect(await check(`MORE${attempt}`)).toMatchObject({ ok: false, reason: "rate_limited" });
    }
    expect(total()).toBe(before);
    expect(row<{ attempts: number }>(db, "SELECT max(attempts) AS attempts FROM order_rate_limits").attempts).toBe(
      ORDER_LIMITS.couponIp,
    );
  });
});

describe("coupon use on cancel and reopen", () => {
  let db: TestD1;
  let product: { id: number; price: number };
  beforeEach(() => {
    db = createTestD1();
    product = pick(db);
  });

  async function place(coupon: number) {
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const placed = await submit(
      db,
      request(items, { couponCode: "SAVE10", couponDiscount: Math.floor(product.price / 10) }),
    );
    if (!placed.ok) throw new Error(placed.message);
    expect(usedCount(db, coupon)).toBeGreaterThan(0);
    return row<{ id: string }>(db, "SELECT id FROM orders WHERE reference = ?", placed.reference).id;
  }
  const step = (
    id: string,
    status: "new" | "confirmed" | "cancelled",
    payment: "unpaid" | "paid" | "refunded" = "unpaid",
  ) => {
    const { version } = row<{ version: number }>(db, "SELECT version FROM orders WHERE id = ?", id);
    return updateOrderStatus(db, owner, { id, version, status, paymentStatus: payment, note: "" }, T0);
  };
  const returned = (id: string) =>
    row<{ coupon_returned: number }>(db, "SELECT coupon_returned FROM orders WHERE id = ?", id).coupon_returned;

  test("cancelling an unpaid order gives the use back, reopening takes it again", async () => {
    const coupon = addCoupon(db, { usage_limit: 3 });
    const id = await place(coupon);
    expect(usedCount(db, coupon)).toBe(1);

    expect((await step(id, "cancelled")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(0);
    expect(returned(id)).toBe(1);

    expect((await step(id, "new")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);
    expect(returned(id)).toBe(0);
  });

  test("a cancel and reopen loop never returns more than the order took", async () => {
    const coupon = addCoupon(db, { usage_limit: 3 });
    const other = await place(coupon);
    const id = await place(coupon);
    expect(usedCount(db, coupon)).toBe(2);
    for (let round = 0; round < 5; round++) {
      await step(id, "cancelled");
      expect(usedCount(db, coupon)).toBe(1);
      await step(id, "new");
      expect(usedCount(db, coupon)).toBe(2);
    }
    expect(returned(other)).toBe(0);
    // A cancelled order cannot be cancelled again, so no second return.
    await step(id, "cancelled");
    expect((await step(id, "cancelled")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);
  });

  test("reopening is refused, and changes nothing, when the returned use was taken by another order", async () => {
    const coupon = addCoupon(db, { usage_limit: 1 });
    const id = await place(coupon);
    expect((await step(id, "cancelled")).ok).toBe(true);
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const taken = await submit(
      db,
      request(items, { couponCode: "SAVE10", couponDiscount: Math.floor(product.price / 10) }),
    );
    expect(taken.ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);

    const reopened = await step(id, "new");
    expect(reopened).toMatchObject({ ok: false, error: expect.stringContaining("SAVE10 has no uses left") });
    expect(row(db, "SELECT status, version, coupon_returned FROM orders WHERE id = ?", id)).toEqual({
      status: "cancelled",
      version: 2,
      coupon_returned: 1,
    });
    expect(usedCount(db, coupon)).toBe(1);

    // Raising the limit lets the reopen through, and it takes the use.
    db.sqlite.run("UPDATE discounts SET usage_limit = 2 WHERE id = ?", [coupon]);
    expect((await step(id, "new")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(2);
  });

  test("the claim itself refuses a reopen that lost its use after the check", async () => {
    const coupon = addCoupon(db, { usage_limit: 1 });
    const id = await place(coupon);
    await step(id, "cancelled");
    const realPrepare = db.prepare.bind(db);
    let raced = false;
    db.prepare = (sql: string) => {
      if (!raced && sql.startsWith("UPDATE orders SET status")) {
        raced = true;
        db.sqlite.run("UPDATE discounts SET used_count = 1 WHERE id = ?", [coupon]);
      }
      return realPrepare(sql);
    };
    const result = await step(id, "new");
    db.prepare = realPrepare;
    expect(result.ok).toBe(false);
    expect(row(db, "SELECT status, coupon_returned FROM orders WHERE id = ?", id)).toEqual({
      status: "cancelled",
      coupon_returned: 1,
    });
    expect(usedCount(db, coupon)).toBe(1);
  });

  test("cancelling a previously paid order while setting paymentStatus to unpaid still keeps its coupon use", async () => {
    const coupon = addCoupon(db, { usage_limit: 1 });
    const id = await place(coupon);
    expect(usedCount(db, coupon)).toBe(1);

    expect((await step(id, "confirmed", "paid")).ok).toBe(true);
    expect((await step(id, "cancelled", "unpaid")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);
    expect(returned(id)).toBe(0);
  });

  test("a paid or refunded order keeps its use when cancelled, and a reopen claims nothing", async () => {
    const coupon = addCoupon(db, { usage_limit: 5 });
    const paid = await place(coupon);
    const refunded = await place(coupon);
    expect(usedCount(db, coupon)).toBe(2);

    expect((await step(paid, "cancelled", "paid")).ok).toBe(true);
    expect((await step(refunded, "cancelled", "refunded")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(2);
    expect(returned(paid) + returned(refunded)).toBe(0);

    expect((await step(paid, "new", "paid")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(2);
  });

  test("an unlimited coupon works the same, and an order without a coupon returns nothing", async () => {
    const coupon = addCoupon(db);
    const id = await place(coupon);
    await step(id, "cancelled");
    expect(usedCount(db, coupon)).toBe(0);
    await step(id, "new");
    expect(usedCount(db, coupon)).toBe(1);

    const plain = await submit(db, request([{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }]));
    if (!plain.ok) throw new Error(plain.message);
    const plainId = row<{ id: string }>(db, "SELECT id FROM orders WHERE reference = ?", plain.reference).id;
    await step(plainId, "cancelled");
    expect(returned(plainId)).toBe(0);
    expect(usedCount(db, coupon)).toBe(1);
  });

  test("used_count never goes below 0", async () => {
    const coupon = addCoupon(db, { usage_limit: 3 });
    const id = await place(coupon);
    db.sqlite.run("UPDATE discounts SET used_count = 0 WHERE id = ?", [coupon]);
    expect((await step(id, "cancelled")).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(0);
  });

  test("query plans: primary key lookups, no scan", () => {
    const plan = (sql: string) =>
      (
        db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...[...sql.matchAll(/\?/g)].map(() => "x")) as {
          detail: string;
        }[]
      )
        .map((r) => r.detail)
        .join(" | ");
    for (const sql of [
      "SELECT coupon_id, coupon_returned FROM orders WHERE id = ?",
      "SELECT d.code FROM orders o JOIN discounts d ON d.id = o.coupon_id WHERE o.id = ? AND o.coupon_returned = 1 AND d.usage_limit IS NOT NULL AND d.used_count >= d.usage_limit",
      "UPDATE discounts SET used_count = MAX(used_count - 1, 0) WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND coupon_returned = 0)",
      "UPDATE discounts SET used_count = used_count + 1 WHERE id = ? AND (usage_limit IS NULL OR used_count < usage_limit) AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND coupon_returned = 1)",
      "UPDATE orders SET coupon_returned = 1 WHERE id = ? AND coupon_returned = 0",
    ]) {
      const details = plan(sql);
      if (process.env.SHOW_PLANS) console.log(sql.slice(0, 70), "=>", details);
      expect(details).not.toMatch(/SCAN (orders|discounts)(?! USING)|TEMP B-TREE/);
    }
  });
});

describe("write-time coupon dates", () => {
  test("a coupon that ended after it was read saves no order and takes no use", async () => {
    const db = createTestD1();
    const product = pick(db);
    const coupon = addCoupon(db, { usage_limit: 5 });
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const realPrepare = db.prepare.bind(db);
    let raced = false;
    db.prepare = (sql: string) => {
      // After the shop read the coupon as live, its end date passes before the order batch runs.
      if (!raced && sql.startsWith("INSERT INTO orders")) {
        raced = true;
        db.sqlite.run("UPDATE discounts SET ends_at = ? WHERE id = ?", [iso(NOW - 1), coupon]);
      }
      return realPrepare(sql);
    };
    const result = await submit(
      db,
      request(items, { couponCode: "SAVE10", couponDiscount: Math.floor(product.price / 10) }),
    );
    db.prepare = realPrepare;
    expect(result).toMatchObject({ ok: false, code: "price_changed", coupon: { ok: false, reason: "unknown" } });
    expect(count(db, "orders")).toBe(0);
    expect(usedCount(db, coupon)).toBe(0);
  });

  test("the start is inclusive and the end exclusive at the order time", async () => {
    const db = createTestD1();
    const product = pick(db);
    const items = [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }];
    const discount = Math.floor(product.price / 10);
    const coupon = addCoupon(db, { starts_at: iso(NOW), ends_at: iso(NOW + HOUR) });
    expect((await submit(db, request(items, { couponCode: "SAVE10", couponDiscount: discount }))).ok).toBe(true);
    expect(usedCount(db, coupon)).toBe(1);
    const ending = addCoupon(db, { code: "ENDS", starts_at: iso(NOW - HOUR), ends_at: iso(NOW) });
    const ended = await submit(db, request(items, { couponCode: "ENDS", couponDiscount: discount }));
    expect(ended.ok).toBe(false);
    expect(usedCount(db, ending)).toBe(0);
  });
});

describe("admin date inputs", () => {
  const base = {
    name: "Eid coupon",
    code: "EID25",
    type: "percent",
    value: 25,
    minOrder: null,
    maxDiscount: null,
    usageLimit: null,
    startsAt: "2026-11-15T00:00:00.000Z",
    endsAt: null,
    active: true,
  };
  const ok = (over: object) => couponInputSchema.safeParse({ ...base, ...over }).success;

  test("a year outside 2000 to 9999 or a long string is refused", () => {
    expect(ok({})).toBe(true);
    expect(ok({ startsAt: "2000-01-01T00:00:00.000Z" })).toBe(true);
    expect(ok({ endsAt: "9999-12-31T23:59:59.000Z" })).toBe(true);
    expect(ok({ startsAt: "1999-12-31T23:59:59.000Z" })).toBe(false);
    expect(ok({ endsAt: "+010000-01-01T00:00:00.000Z" })).toBe(false);
    expect(ok({ endsAt: "2026-12-01T00:00:00.000Z" + " ".repeat(40) })).toBe(false);
    expect(ok({ startsAt: "x".repeat(10_000) })).toBe(false);
    expect(ok({ startsAt: "not a date" })).toBe(false);
  });
});

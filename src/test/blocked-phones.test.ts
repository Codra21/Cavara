import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminIdentity } from "@/domain/admin";
import { blockPhoneSchema, unblockPhoneSchema } from "@/domain/blocked-phones";
import { MAX_OPEN_ORDERS, type UpdateOrderInput } from "@/domain/orders";
import { listAudit } from "@/server/admin/auth.server";
import {
  blockPhone,
  isPhoneBlocked,
  LIST_BLOCKED_SQL,
  listBlockedPhones,
  unblockPhone,
} from "@/server/db/admin-blocked-phones.repository";
import { getOrder, updateOrderStatus } from "@/server/db/admin-orders.repository";
import { PHONE_STANDING_SQL } from "@/server/db/orders.repository";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const T0 = new Date("2026-11-07T04:00:00.000Z");
const PHONE = "01712345678";
const RATE_LIMIT_MESSAGE =
  "Too many orders from this number or connection. Please wait 15 minutes, or message us on WhatsApp.";

function checkout(db: TestD1, over: { phone?: string; couponCode?: string } = {}) {
  const [product] = db.sqlite
    .query(
      `SELECT p.id, p.price, v.position FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.status = 'published' ORDER BY p.id, v.position LIMIT 1`,
    )
    .all() as { id: number; price: number; position: number }[];
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "Test Customer",
    phone: over.phone ?? PHONE,
    zoneId: "inside-dhaka",
    address: "House 1, Road 2, Dhanmondi, Dhaka",
    note: "",
    deliveryCharge: 80,
    items: [{ productId: product!.id, variant: product!.position, qty: 1, unitPrice: product!.price }],
    website: "",
  };
}

// A fresh client per call keeps the IP rate limit out of these tests.
const place = (db: TestD1, over: { phone?: string } = {}) =>
  submitOrder(db, checkout(db, over), { client: crypto.randomUUID(), limitSecret: "x".repeat(40), now: T0 });

const count = (db: TestD1, table: string) =>
  (db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const orderId = (db: TestD1, reference: string) =>
  (db.sqlite.query("SELECT id FROM orders WHERE reference = ?").get(reference) as { id: string }).id;

const change = (id: string, version: number, status: UpdateOrderInput["status"]): UpdateOrderInput => ({
  id,
  version,
  status,
  paymentStatus: "unpaid",
  note: "",
});

describe("blocked phones", () => {
  test("a blocked number is refused with the rate-limit answer and nothing is written", async () => {
    const db = createTestD1();
    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: "+880 1712-345678", reason: "fake orders" }), T0);
    const before = {
      orders: count(db, "orders"),
      items: count(db, "order_items"),
      history: count(db, "order_status_history"),
      movements: count(db, "stock_movements"),
      outbox: count(db, "order_notification_outbox"),
      limits: count(db, "order_rate_limits"),
    };
    const result = await place(db);
    expect(result).toEqual({ ok: false, code: "rate_limited", message: RATE_LIMIT_MESSAGE });
    expect({
      orders: count(db, "orders"),
      items: count(db, "order_items"),
      history: count(db, "order_status_history"),
      movements: count(db, "stock_movements"),
      outbox: count(db, "order_notification_outbox"),
      limits: count(db, "order_rate_limits"),
    }).toEqual(before);
    expect(db.sqlite.query("SELECT count(*) AS n FROM daily_totals").get()).toEqual({ n: 0 });
  });

  test("a blocked number saves no coupon use and no stock change", async () => {
    const db = createTestD1();
    db.sqlite.run(
      `INSERT INTO discounts (name, kind, scope, type, value, starts_at, active, created_at, updated_at, revision, code, usage_limit)
       VALUES ('Test', 'coupon', 'all', 'amount', 10, '2020-01-01T00:00:00.000Z', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'r', 'SAVE10', 5)`,
    );
    db.sqlite.run("UPDATE product_variants SET stock = 5 WHERE id = (SELECT MIN(id) FROM product_variants)");
    const stockBefore = db.sqlite.query("SELECT id, stock FROM product_variants WHERE stock IS NOT NULL").all();
    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: PHONE }), T0);
    const body = { ...checkout(db), couponCode: "SAVE10", couponDiscount: 10 };
    expect(await submitOrder(db, body, { client: "203.0.113.9", limitSecret: "x".repeat(40), now: T0 })).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    expect(db.sqlite.query("SELECT used_count FROM discounts WHERE code = 'SAVE10'").get()).toEqual({ used_count: 0 });
    expect(db.sqlite.query("SELECT id, stock FROM product_variants WHERE stock IS NOT NULL").all()).toEqual(
      stockBefore,
    );
    expect(count(db, "stock_movements")).toBe(0);
  });

  test("the order insert itself refuses a blocked number, even when the service read came first", async () => {
    // insertOrder is the atomic guard: block between the service's read and the batch by calling it directly.
    const db = createTestD1();
    const { insertOrder } = await import("@/server/db/orders.repository");
    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: PHONE }), T0);
    const input = (await import("@/domain/orders")).checkoutSchema.parse(checkout(db));
    const placed = await insertOrder(db, {
      id: crypto.randomUUID(),
      reference: "CV-AAAAAA",
      idempotencyKey: input.idempotencyKey,
      payloadHash: "h",
      input,
      zone: { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      lines: [],
      itemsTotal: 100,
      coupon: null,
      subtotal: 100,
      total: 180,
      itemCount: 1,
      shopDay: "2026-11-07",
      createdAt: T0.toISOString(),
    });
    expect(placed).toBe(false);
    expect(count(db, "orders")).toBe(0);
    expect(count(db, "daily_totals")).toBe(0);
  });

  test("other numbers still order, and unblocking lets the number order again", async () => {
    const db = createTestD1();
    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: PHONE }), T0);
    expect(await place(db, { phone: "01812345678" })).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(await unblockPhone(db, owner, PHONE, T0)).toBe(true);
    expect(await place(db)).toMatchObject({ ok: true });
  });

  test("blocking does not cancel existing orders", async () => {
    const db = createTestD1();
    const first = await place(db);
    if (!first.ok) throw new Error("setup");
    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: PHONE }), T0);
    expect(db.sqlite.query("SELECT status FROM orders").all()).toEqual([{ status: "new" }]);
  });

  test("block and unblock list, audit once and are idempotent", async () => {
    const db = createTestD1();
    const input = blockPhoneSchema.parse({
      phone: "01712-345678",
      reason: "  repeat   fake  ",
      orderId: crypto.randomUUID(),
    });
    expect(input.phone).toBe(PHONE);
    expect(input.reason).toBe("repeat fake");
    expect(await blockPhone(db, owner, input, T0)).toBe(true);
    expect(await blockPhone(db, owner, input, T0)).toBe(false);
    expect(await isPhoneBlocked(db, PHONE)).toBe(true);
    expect(await listBlockedPhones(db)).toEqual([
      { phone: PHONE, reason: "repeat fake", createdAt: T0.toISOString(), createdBy: "owner" },
    ]);
    expect(await unblockPhone(db, owner, PHONE, T0)).toBe(true);
    expect(await unblockPhone(db, owner, PHONE, T0)).toBe(false);
    expect(await isPhoneBlocked(db, PHONE)).toBe(false);
    const audit = await listAudit(db);
    expect(audit.map((row) => row.action).sort()).toEqual(["phone.blocked", "phone.unblocked"]);
    // The audit log holds no customer contact data.
    expect(JSON.stringify(audit)).not.toContain(PHONE);
  });

  test("input validation rejects numbers orders would reject and long reasons", () => {
    expect(blockPhoneSchema.safeParse({ phone: "12345" }).success).toBe(false);
    expect(unblockPhoneSchema.safeParse({ phone: "029876543" }).success).toBe(false);
    expect(blockPhoneSchema.safeParse({ phone: PHONE, reason: "x".repeat(201) }).success).toBe(false);
  });

  test("every function in the blocked-phones file is Owner only", () => {
    const source = readFileSync(join(import.meta.dir, "../server/functions/admin-blocked-phones.functions.ts"), "utf8");
    const declarations = source.match(/createServerFn\(/g) ?? [];
    const owned = source.match(/\.middleware\(\[ownerAuthMiddleware\]\)/g) ?? [];
    expect(declarations.length).toBeGreaterThanOrEqual(4);
    expect(owned.length).toBe(declarations.length);
    expect(source).not.toContain("adminAuthMiddleware");
  });
});

describe("open-order cap", () => {
  test("a third 'new' order from one phone is refused and leaves nothing behind", async () => {
    const db = createTestD1();
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) expect(await place(db)).toMatchObject({ ok: true });
    db.sqlite.run("UPDATE product_variants SET stock = 5 WHERE id = (SELECT MIN(id) FROM product_variants)");
    const before = {
      orders: count(db, "orders"),
      movements: count(db, "stock_movements"),
      limits: count(db, "order_rate_limits"),
      stock: db.sqlite.query("SELECT id, stock FROM product_variants WHERE stock IS NOT NULL").all(),
    };
    const result = await place(db);
    expect(result).toMatchObject({
      ok: false,
      code: "open_orders",
      message:
        "You already have 2 orders waiting for our call. We'll contact you soon; reply to us if you need to change them.",
    });
    expect({
      orders: count(db, "orders"),
      movements: count(db, "stock_movements"),
      limits: count(db, "order_rate_limits"),
      stock: db.sqlite.query("SELECT id, stock FROM product_variants WHERE stock IS NOT NULL").all(),
    }).toEqual(before);
    // Another number is unaffected.
    expect(await place(db, { phone: "01812345678" })).toMatchObject({ ok: true });
  });

  test("the guarded insert holds the cap even when the service's read is stale", async () => {
    const db = createTestD1();
    const { insertOrder } = await import("@/server/db/orders.repository");
    const { checkoutSchema } = await import("@/domain/orders");
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) expect(await place(db)).toMatchObject({ ok: true });
    const input = checkoutSchema.parse(checkout(db));
    const placed = await insertOrder(db, {
      id: crypto.randomUUID(),
      reference: "CV-AAAAAA",
      idempotencyKey: input.idempotencyKey,
      payloadHash: "h",
      input,
      zone: { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      lines: [],
      itemsTotal: 100,
      coupon: null,
      subtotal: 100,
      total: 180,
      itemCount: 1,
      shopDay: "2026-11-07",
      createdAt: T0.toISOString(),
    });
    expect(placed).toBe(false);
    expect(count(db, "orders")).toBe(MAX_OPEN_ORDERS);
    expect(count(db, "daily_totals") + count(db, "order_notification_outbox")).toBe(1 + MAX_OPEN_ORDERS);
  });

  test("the cap frees when an order is confirmed or cancelled", async () => {
    const db = createTestD1();
    const refs: string[] = [];
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) {
      const result = await place(db);
      if (!result.ok) throw new Error("setup");
      refs.push(result.reference);
    }
    expect(await place(db)).toMatchObject({ ok: false, code: "open_orders" });

    const first = orderId(db, refs[0]!);
    expect(await updateOrderStatus(db, owner, change(first, 1, "confirmed"), T0)).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: false, code: "open_orders" });

    const second = orderId(db, refs[1]!);
    expect(await updateOrderStatus(db, owner, change(second, 1, "cancelled"), T0)).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: true });
  });

  test("reopening a cancelled order does not bypass the cap check on new orders", async () => {
    const db = createTestD1();
    const first = await place(db);
    if (!first.ok) throw new Error("setup");
    const id = orderId(db, first.reference);
    await updateOrderStatus(db, owner, change(id, 1, "cancelled"), T0);
    expect(await place(db)).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: true });
    // Two orders are 'new' now; a third is refused whether or not the cancelled one exists.
    expect(await place(db)).toMatchObject({ ok: false, code: "open_orders" });
    expect((await getOrder(db, id))?.status).toBe("cancelled");
  });

  test("an idempotent replay of a saved order still returns it when the phone is at the cap", async () => {
    const db = createTestD1();
    const body = checkout(db);
    const context = { client: "203.0.113.9", limitSecret: "x".repeat(40), now: T0 };
    const first = await submitOrder(db, body, context);
    expect(first).toMatchObject({ ok: true });
    expect(await place(db)).toMatchObject({ ok: true });
    expect(await submitOrder(db, body, context)).toMatchObject({ ok: true, replayed: true });
  });
});

describe("query plans", () => {
  const plan = (db: TestD1, sql: string, ...params: unknown[]) =>
    (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as string[])) as { detail: string }[])
      .map((row) => row.detail)
      .join("\n");

  test("the phone standing read and the cap count use indexes only", () => {
    const db = createTestD1();
    const detail = plan(db, PHONE_STANDING_SQL, PHONE, PHONE);
    expect(detail).toContain("sqlite_autoindex_blocked_phones_1");
    expect(detail).toContain("idx_orders_phone_new");
    expect(detail).not.toMatch(/SCAN (orders|blocked_phones)\b(?! USING)/);
    expect(detail).not.toContain("TEMP B-TREE");
  });

  test("the blocked list reads through its index without a sort", () => {
    const db = createTestD1();
    const detail = plan(db, LIST_BLOCKED_SQL);
    expect(detail).toContain("idx_blocked_phones_created");
    expect(detail).not.toContain("TEMP B-TREE");
  });
});

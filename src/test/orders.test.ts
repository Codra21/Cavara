import { describe, expect, test } from "bun:test";
import { type CheckoutRequest, normalizePhone, ORDER_LIMITS, shopDay } from "@/domain/orders";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { submitOrder, type SubmitContext } from "@/server/services/orders.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const T0 = new Date("2026-11-06T20:30:00.000Z"); // 02:30 on 7 Nov in Dhaka
const context = (over: Partial<SubmitContext> = {}): SubmitContext => ({
  client: "203.0.113.9",
  limitSecret: "test-order-limit-secret-0123456789abcdef",
  now: T0,
  ...over,
});

function seedProduct(db: TestD1) {
  return db.sqlite
    .query(
      `SELECT p.id, p.price, v.position FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.status = 'published' ORDER BY p.id, v.position LIMIT 2`,
    )
    .all() as { id: number; price: number; position: number }[];
}

function request(db: TestD1, over: Partial<CheckoutRequest> = {}): CheckoutRequest {
  const [a, b] = seedProduct(db);
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "  Nusrat   Jahan ",
    phone: "+880 1712-345678",
    zoneId: "inside-dhaka",
    address: "House 12, Road 5, Dhanmondi, Dhaka",
    note: "Call before coming",
    deliveryCharge: 80,
    items: [
      { productId: a!.id, variant: a!.position, qty: 2, unitPrice: a!.price },
      { productId: b!.id, variant: b!.position, qty: 1, unitPrice: b!.price },
    ],
    website: "",
    ...over,
  };
}

describe("normalizePhone", () => {
  test("accepts local and international forms", () => {
    for (const raw of ["01712345678", "01712-345678", "+8801712345678", "8801712345678", "0088 01712 345 678"]) {
      expect(normalizePhone(raw)).toBe("01712345678");
    }
  });
  test("rejects landlines, wrong lengths and other operators' prefixes", () => {
    for (const raw of ["0171234567", "017123456789", "01212345678", "029876543", "hello", ""]) {
      expect(normalizePhone(raw)).toBeNull();
    }
  });
});

test("shopDay uses Dhaka time", () => {
  expect(shopDay(new Date("2026-11-06T17:59:59Z"))).toBe("2026-11-06");
  expect(shopDay(new Date("2026-11-06T18:00:00Z"))).toBe("2026-11-07");
});

describe("submitOrder", () => {
  test("saves the order, its lines with price and cost snapshots, history and the day's count", async () => {
    const db = createTestD1();
    db.sqlite.run("UPDATE products SET cost_price = 300");
    const body = request(db);
    const result = await submitOrder(db, body, context());
    if (!result.ok) throw new Error(result.message);
    expect(result.reference).toMatch(/^CV-[2-9A-HJKMNP-Z]{6}$/);
    expect(result.replayed).toBe(false);

    const order = db.sqlite.query("SELECT * FROM orders").get() as Record<string, unknown>;
    const subtotal = body.items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    expect(order).toMatchObject({
      reference: result.reference,
      customer_name: "Nusrat Jahan",
      phone: "01712345678",
      zone_name: "Inside Dhaka",
      delivery_charge: 80,
      subtotal,
      total: subtotal + 80,
      item_count: 3,
      status: "new",
      payment_status: "unpaid",
      shop_day: "2026-11-07",
    });
    expect(result.total).toBe(subtotal + 80);
    const lines = db.sqlite
      .query("SELECT line, qty, unit_price, cost_price, line_total FROM order_items ORDER BY line")
      .all();
    expect(lines).toEqual(
      body.items.map((item, line) => ({
        line,
        qty: item.qty,
        unit_price: item.unitPrice,
        cost_price: 300,
        line_total: item.unitPrice * item.qty,
      })),
    );
    expect(db.sqlite.query("SELECT to_status, actor_username FROM order_status_history").all()).toEqual([
      { to_status: "new", actor_username: null },
    ]);
    expect(db.sqlite.query("SELECT orders_received, orders_sold FROM daily_totals").get()).toEqual({
      orders_received: 1,
      orders_sold: 0,
    });
    // Rate-limit rows hold HMACs, never the raw phone or IP.
    const limits = JSON.stringify(db.sqlite.query("SELECT * FROM order_rate_limits").all());
    expect(limits).not.toContain("01712345678");
    expect(limits).not.toContain("203.0.113.9");
  });

  test("a retry with the same key returns the same order without saving twice", async () => {
    const db = createTestD1();
    const body = request(db);
    const first = await submitOrder(db, body, context());
    const second = await submitOrder(db, body, context());
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && second.ok && first.reference === second.reference).toBe(true);
    expect(db.sqlite.query("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 1 });
    expect(db.sqlite.query("SELECT orders_received FROM daily_totals").get()).toEqual({ orders_received: 1 });
  });

  test("the same key with a different order is refused", async () => {
    const db = createTestD1();
    const body = request(db);
    await submitOrder(db, body, context());
    const changed = await submitOrder(db, { ...body, address: "Somewhere else entirely, Dhaka" }, context());
    expect(changed).toMatchObject({ ok: false, code: "idempotency_conflict" });
  });

  test("never trusts the client's prices", async () => {
    const db = createTestD1();
    const body = request(db);
    const cheap = { ...body, items: body.items.map((item) => ({ ...item, unitPrice: 1 })) };
    const result = await submitOrder(db, cheap, context());
    expect(result).toMatchObject({ ok: false, code: "price_changed", deliveryCharge: 80 });
    if (!result.ok && result.code === "price_changed") {
      expect(result.prices.map((p) => p.unitPrice)).toEqual(body.items.map((item) => item.unitPrice));
    }
    const wrongCharge = await submitOrder(
      db,
      { ...body, idempotencyKey: crypto.randomUUID(), deliveryCharge: 0 },
      context(),
    );
    expect(wrongCharge).toMatchObject({ ok: false, code: "price_changed" });
    expect(db.sqlite.query("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 0 });
  });

  test("uses the zone's current charge and rejects inactive zones", async () => {
    const db = createTestD1();
    const outside = await submitOrder(db, request(db, { zoneId: "outside-dhaka", deliveryCharge: 150 }), context());
    expect(outside).toMatchObject({ ok: true });
    db.sqlite.run("UPDATE delivery_zones SET active = 0 WHERE id = 'outside-dhaka'");
    const closed = await submitOrder(db, request(db, { zoneId: "outside-dhaka", deliveryCharge: 150 }), context());
    expect(closed).toMatchObject({ ok: false, code: "validation", fieldErrors: { zoneId: "Choose a delivery area" } });
  });

  test("rejects unpublished products and out-of-stock colours", async () => {
    const db = createTestD1();
    const body = request(db);
    db.sqlite.run("UPDATE product_variants SET availability = 'out_of_stock' WHERE product_id = ? AND position = ?", [
      body.items[0]!.productId,
      body.items[0]!.variant,
    ]);
    expect(await submitOrder(db, body, context())).toMatchObject({ ok: false, code: "unavailable" });
    db.sqlite.run("UPDATE product_variants SET availability = 'preorder'");
    db.sqlite.run("UPDATE products SET status = 'archived' WHERE id = ?", [body.items[1]!.productId]);
    expect(await submitOrder(db, { ...body, idempotencyKey: crypto.randomUUID() }, context())).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    const missing = request(db, { items: [{ productId: 99999, variant: 0, qty: 1, unitPrice: 100 }] });
    expect(await submitOrder(db, missing, context())).toMatchObject({ ok: false, code: "unavailable" });
  });

  test("validation errors are reported per field", async () => {
    const db = createTestD1();
    const result = await submitOrder(db, request(db, { name: "A", phone: "12345", address: "short" }), context());
    expect(result).toMatchObject({ ok: false, code: "validation" });
    if (!result.ok && result.code === "validation") {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(["address", "name", "phone"]);
    }
    const empty = await submitOrder(db, request(db, { items: [] }), context());
    expect(empty).toMatchObject({ ok: false, code: "validation", fieldErrors: { items: "Your bag is empty" } });
  });

  test("a filled honeypot saves nothing", async () => {
    const db = createTestD1();
    const result = await submitOrder(db, request(db, { website: "http://spam.example" }), context());
    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(db.sqlite.query("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 0 });
  });

  test("limits orders per phone and per connection, then the window resets", async () => {
    const db = createTestD1();
    for (let i = 0; i < ORDER_LIMITS.phone; i++) {
      expect(await submitOrder(db, request(db), context())).toMatchObject({ ok: true });
    }
    expect(await submitOrder(db, request(db), context())).toMatchObject({ ok: false, code: "rate_limited" });
    // Another number on the same connection still works until the IP limit.
    expect(await submitOrder(db, request(db, { phone: "01812345678" }), context())).toMatchObject({ ok: true });
    const later = new Date(T0.getTime() + 15 * 60 * 1000 + 1);
    expect(await submitOrder(db, request(db), context({ now: later }))).toMatchObject({ ok: true });
  });

  test("a reference collision retries once with a new reference", async () => {
    const db = createTestD1();
    const fixed = () => "CV-AAAAAA";
    await submitOrder(db, request(db), context({ newReference: fixed }));
    let calls = 0;
    const second = await submitOrder(
      db,
      request(db),
      context({ newReference: () => (calls++ === 0 ? "CV-AAAAAA" : "CV-BBBBBB") }),
    );
    expect(second).toMatchObject({ ok: true, reference: "CV-BBBBBB" });
  });
});

describe("delivery zones", () => {
  test("are seeded with the Owner's charges and shipped in the public catalogue", async () => {
    const catalog = await getPublishedCatalog(createTestD1());
    expect(catalog.deliveryZones).toEqual([
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      { id: "outside-dhaka", name: "Outside Dhaka", charge: 150 },
    ]);
  });
});

describe("query plans (D1 read budget)", () => {
  const plan = (db: TestD1, sql: string) =>
    (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join(" | ");

  test("order lookups and admin lists use indexes, never a scan of orders", () => {
    const db = createTestD1();
    const checks = [
      "SELECT reference FROM orders WHERE idempotency_key = 'k'",
      "SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 50",
      "SELECT id FROM orders WHERE (created_at, id) < ('2026', 'x') ORDER BY created_at DESC, id DESC LIMIT 50",
      "SELECT id FROM orders WHERE status = 'new' ORDER BY created_at DESC, id DESC LIMIT 50",
      "SELECT id FROM orders WHERE phone = '01712345678' ORDER BY created_at DESC",
      "DELETE FROM order_rate_limits WHERE expires_at <= 0",
      "SELECT * FROM order_status_history WHERE order_id = 'x' ORDER BY id",
    ];
    for (const sql of checks) {
      const detail = plan(db, sql);
      // "SCAN … USING (COVERING) INDEX" walks an index in order and stops at LIMIT; a bare SCAN reads every row.
      expect(detail).not.toMatch(/SCAN (orders|order_rate_limits|order_status_history)(?! USING)|TEMP B-TREE/);
      expect(detail).toMatch(/USING (COVERING )?INDEX/);
    }
  });
});

test("formatPhone writes numbers the local way", async () => {
  const { formatPhone } = await import("@/domain/orders");
  expect(formatPhone("01812000222")).toBe("01812-000222");
  expect(formatPhone("12345")).toBe("12345");
});

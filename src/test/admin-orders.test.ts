import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { canChangeStatus, ORDER_PAGE_SIZE, parseOrderSearch, type UpdateOrderInput } from "@/domain/orders";
import { listAudit } from "@/server/admin/auth.server";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { getOrder, listOrders, listZones, saveZones, updateOrderStatus } from "@/server/db/admin-orders.repository";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const T0 = new Date("2026-11-07T04:00:00.000Z");

async function placeOrder(db: TestD1, over: { phone?: string; at?: Date; client?: string } = {}) {
  const [product] = db.sqlite
    .query(
      `SELECT p.id, p.price, v.position FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.status = 'published' ORDER BY p.id, v.position LIMIT 1`,
    )
    .all() as { id: number; price: number; position: number }[];
  const result = await submitOrder(
    db,
    {
      idempotencyKey: crypto.randomUUID(),
      name: "Test Customer",
      phone: over.phone ?? "01712345678",
      zoneId: "inside-dhaka",
      address: "House 1, Road 2, Dhanmondi, Dhaka",
      note: "",
      deliveryCharge: 80,
      items: [{ productId: product!.id, variant: product!.position, qty: 2, unitPrice: product!.price }],
      website: "",
    },
    { client: over.client ?? crypto.randomUUID(), limitSecret: "x".repeat(40), now: over.at ?? T0 },
  );
  if (!result.ok) throw new Error(result.message);
  const id = (db.sqlite.query("SELECT id FROM orders WHERE reference = ?").get(result.reference) as { id: string }).id;
  return { id, reference: result.reference, price: product!.price };
}

const change = (id: string, version: number, over: Partial<UpdateOrderInput> = {}): UpdateOrderInput => ({
  id,
  version,
  status: "confirmed",
  paymentStatus: "unpaid",
  note: "",
  ...over,
});

const totals = (db: TestD1) =>
  db.sqlite.query("SELECT orders_received, orders_sold, revenue, profit, lines_without_cost FROM daily_totals").get();

describe("status rules", () => {
  test("orders move forward, can be cancelled until delivered, and reopened after cancelling", () => {
    expect(canChangeStatus("new", "confirmed")).toBe(true);
    expect(canChangeStatus("new", "delivered")).toBe(false);
    expect(canChangeStatus("dispatched", "cancelled")).toBe(true);
    expect(canChangeStatus("delivered", "cancelled")).toBe(false);
    expect(canChangeStatus("cancelled", "new")).toBe(true);
    expect(canChangeStatus("cancelled", "confirmed")).toBe(false);
  });

  test("search understands phone numbers and references only", () => {
    expect(parseOrderSearch("+880 1712-345678")).toEqual({ phone: "01712345678" });
    expect(parseOrderSearch("cv-7kq2mx")).toEqual({ reference: "CV-7KQ2MX" });
    expect(parseOrderSearch("7KQ2MX")).toEqual({ reference: "CV-7KQ2MX" });
    expect(parseOrderSearch("Nusrat Jahan")).toBeNull();
    expect(parseOrderSearch("CV-OIL000")).toBeNull();
  });
});

describe("updateOrderStatus", () => {
  test("confirming books the sale on the order's day, with profit from cost snapshots", async () => {
    const db = createTestD1();
    db.sqlite.run("UPDATE products SET cost_price = 500");
    const { id, price } = await placeOrder(db);
    const result = await updateOrderStatus(db, owner, change(id, 1, { note: "Called, confirmed" }), T0);
    expect(result).toEqual({ ok: true, version: 2 });

    const order = (await getOrder(db, id))!;
    expect(order.status).toBe("confirmed");
    expect(order.history.map((event) => [event.toStatus, event.actorUsername, event.note])).toEqual([
      ["new", null, ""],
      ["confirmed", "owner", "Called, confirmed"],
    ]);
    expect(totals(db)).toEqual({
      orders_received: 1,
      orders_sold: 1,
      revenue: price * 2,
      profit: (price - 500) * 2,
      lines_without_cost: 0,
    });
    const confirmedAt = db.sqlite.query("SELECT confirmed_at FROM orders").get() as { confirmed_at: string };
    expect(confirmedAt.confirmed_at).toBe(T0.toISOString());
    expect((await listAudit(db))[0]).toMatchObject({ action: "order.updated", targetId: id });
  });

  test("moving between sold statuses doesn't count twice; cancelling takes the sale back out", async () => {
    const db = createTestD1();
    const { id } = await placeOrder(db);
    await updateOrderStatus(db, owner, change(id, 1), T0);
    await updateOrderStatus(db, owner, change(id, 2, { status: "dispatched" }), T0);
    expect(totals(db)).toMatchObject({ orders_sold: 1, lines_without_cost: 1 });
    await updateOrderStatus(db, owner, change(id, 3, { status: "cancelled" }), T0);
    expect(totals(db)).toMatchObject({
      orders_received: 1,
      orders_sold: 0,
      revenue: 0,
      profit: 0,
      lines_without_cost: 0,
    });
    // Reopening returns it to "new" without counting a sale.
    expect(await updateOrderStatus(db, owner, change(id, 4, { status: "new" }), T0)).toEqual({ ok: true, version: 5 });
    expect(totals(db)).toMatchObject({ orders_sold: 0 });
  });

  test("refuses skipped steps and changes after delivery", async () => {
    const db = createTestD1();
    const { id } = await placeOrder(db);
    expect(await updateOrderStatus(db, owner, change(id, 1, { status: "delivered" }), T0)).toMatchObject({ ok: false });
    await updateOrderStatus(db, owner, change(id, 1), T0);
    await updateOrderStatus(db, owner, change(id, 2, { status: "dispatched" }), T0);
    await updateOrderStatus(db, owner, change(id, 3, { status: "delivered", paymentStatus: "paid" }), T0);
    expect(await updateOrderStatus(db, owner, change(id, 4, { status: "cancelled" }), T0)).toMatchObject({ ok: false });
    // Payment can still be corrected on a delivered order.
    expect(
      await updateOrderStatus(db, owner, change(id, 4, { status: "delivered", paymentStatus: "refunded" }), T0),
    ).toEqual({ ok: true, version: 5 });
  });

  test("a stale version changes nothing: no history, no totals, no audit", async () => {
    const db = createTestD1();
    const { id } = await placeOrder(db);
    expect(await updateOrderStatus(db, owner, change(id, 1), T0)).toMatchObject({ ok: true });
    const auditBefore = (await listAudit(db)).length;
    const stale = await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((await getOrder(db, id))!.history).toHaveLength(2);
    expect(totals(db)).toMatchObject({ orders_sold: 1 });
    expect((await listAudit(db)).length).toBe(auditBefore);
  });

  test("the batch guard stops a second change racing on the same version", async () => {
    const db = createTestD1();
    const { id } = await placeOrder(db);
    // Both read version 1 before either writes, as two tabs would.
    const [a, b] = await Promise.all([
      updateOrderStatus(db, owner, change(id, 1), T0),
      updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await getOrder(db, id))!.history).toHaveLength(2);
    const sold = (totals(db) as { orders_sold: number }).orders_sold;
    expect(sold).toBe((await getOrder(db, id))!.status === "confirmed" ? 1 : 0);
  });
});

describe("listOrders", () => {
  test("newest first, filtered by status, searched by phone or reference, with keyset pages", async () => {
    const db = createTestD1();
    const first = await placeOrder(db, { at: new Date("2026-11-07T01:00:00Z") });
    const second = await placeOrder(db, { at: new Date("2026-11-07T02:00:00Z"), phone: "01812345678" });
    await updateOrderStatus(db, owner, change(first.id, 1), T0);

    expect((await listOrders(db)).orders.map((order) => order.reference)).toEqual([second.reference, first.reference]);
    expect((await listOrders(db, { status: "confirmed" })).orders.map((order) => order.id)).toEqual([first.id]);
    expect((await listOrders(db, { search: "01812-345678" })).orders.map((order) => order.id)).toEqual([second.id]);
    expect((await listOrders(db, { search: first.reference.toLowerCase() })).orders.map((order) => order.id)).toEqual([
      first.id,
    ]);
    expect((await listOrders(db, { search: "Test Customer" })).orders).toEqual([]);
  });

  test("pages hold 50 orders and the cursor continues without repeats", async () => {
    const db = createTestD1();
    for (let i = 0; i < ORDER_PAGE_SIZE + 3; i++) {
      await placeOrder(db, { at: new Date(T0.getTime() + i * 1000), phone: `0171${String(i).padStart(7, "0")}` });
    }
    const page1 = await listOrders(db);
    expect(page1.orders).toHaveLength(ORDER_PAGE_SIZE);
    expect(page1.next).not.toBeNull();
    const page2 = await listOrders(db, { after: page1.next });
    expect(page2.orders).toHaveLength(3);
    expect(page2.next).toBeNull();
    const ids = new Set([...page1.orders, ...page2.orders].map((order) => order.id));
    expect(ids.size).toBe(ORDER_PAGE_SIZE + 3);
  });
});

describe("saveZones", () => {
  test("edits charges, adds an area, switches one off; the catalogue follows", async () => {
    const db = createTestD1();
    const result = await saveZones(db, owner, [
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 90, active: true },
      { id: "outside-dhaka", name: "Outside Dhaka", charge: 150, active: false },
      { id: null, name: "Dhaka Suburbs", charge: 120, active: true },
    ]);
    expect(result.ok).toBe(true);
    expect((await getPublishedCatalog(db)).deliveryZones).toEqual([
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 90 },
      { id: "dhaka-suburbs", name: "Dhaka Suburbs", charge: 120 },
    ]);
    expect((await listZones(db)).find((zone) => zone.id === "outside-dhaka")?.active).toBe(false);
    expect((await listAudit(db))[0]).toMatchObject({ action: "zones.updated" });
  });

  test("never deletes an area and rejects unknown ids", async () => {
    const db = createTestD1();
    const dropped = await saveZones(db, owner, [
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 80, active: true },
    ]);
    expect(dropped).toMatchObject({ ok: false });
    const unknown = await saveZones(db, owner, [
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 80, active: true },
      { id: "outside-dhaka", name: "Outside Dhaka", charge: 150, active: true },
      { id: "nowhere", name: "Nowhere", charge: 1, active: true },
    ]);
    expect(unknown).toMatchObject({ ok: false });
  });

  test("an order keeps the charge it was placed with after the zone changes", async () => {
    const db = createTestD1();
    const { id } = await placeOrder(db);
    await saveZones(db, owner, [
      { id: "inside-dhaka", name: "Inside Dhaka", charge: 100, active: true },
      { id: "outside-dhaka", name: "Outside Dhaka", charge: 150, active: true },
    ]);
    expect((await getOrder(db, id))!.deliveryCharge).toBe(80);
  });
});

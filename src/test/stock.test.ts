import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { adminProductListSchema } from "@/domain/admin-product-list";
import { type ProductFormValues, productInputSchema } from "@/domain/product-admin";
import { type CheckoutRequest, type UpdateOrderInput } from "@/domain/orders";
import {
  adjustStockSchema,
  availabilityFromStock,
  crossesZero,
  LOW_STOCK_LIMIT,
  shortageMessage,
  stopCountingSchema,
} from "@/domain/stock";
import { listAudit } from "@/server/admin/auth.server";
import { getAdminProduct, saveProduct } from "@/server/db/admin-catalog.repository";
import { updateOrderStatus } from "@/server/db/admin-orders.repository";
import { buildListStatements, listAdminProducts } from "@/server/db/admin-product-list.repository";
import { insertOrder, readSelections } from "@/server/db/orders.repository";
import {
  adjustStock,
  listStockMovements,
  readCrossedProducts,
  readReopenShortages,
  REOPEN_FITS,
  stopCounting,
} from "@/server/db/stock.repository";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1, migrationFiles, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const T0 = new Date("2026-11-15T04:00:00.000Z");
const IMG = "product-images/test/a.webp";

/** A new published product with the given colours; returns the variant ids by name. */
async function makeProduct(db: TestD1, colours: string[], over: Partial<ProductFormValues> = {}) {
  const values: ProductFormValues = {
    name: `Stock Mug ${Math.random().toString(36).slice(2, 8)}`,
    slug: `stock-mug-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: "drinkware",
    summary: "",
    details: [],
    note: "",
    price: 500,
    regularPrice: null,
    costPrice: 300,
    status: "published",
    featured: false,
    sort: 999,
    variants: colours.map((name) => ({ id: null, name, swatch: "#ccc", availability: "in_stock", images: [IMG] })),
    ...over,
  };
  const saved = await saveProduct(db, {
    actor: owner,
    id: null,
    revision: "",
    input: productInputSchema.parse(values),
  });
  if (!saved.ok) throw new Error(saved.error);
  const rows = db.sqlite
    .query("SELECT id, name, position FROM product_variants WHERE product_id = ? ORDER BY position")
    .all(saved.id) as { id: number; name: string; position: number }[];
  return { id: saved.id, revision: saved.revision, variants: rows, values };
}

const count = async (db: TestD1, productId: number, variantId: number, quantity: number) => {
  const result = await adjustStock(
    db,
    owner,
    adjustStockSchema.parse({ productId, variantId, action: "start", quantity, note: "" }),
    T0,
  );
  if (!result.ok) throw new Error(result.error);
  return result;
};

const stockOf = (db: TestD1, variantId: number) =>
  db.sqlite.query("SELECT stock, availability FROM product_variants WHERE id = ?").get(variantId) as {
    stock: number | null;
    availability: string;
  };

const rowsIn = (db: TestD1, table: string) =>
  (db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

function checkout(items: { productId: number; variant: number; qty: number; unitPrice?: number }[]): CheckoutRequest {
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "Test Customer",
    phone: "01712345678",
    zoneId: "inside-dhaka",
    address: "House 1, Road 2, Dhanmondi, Dhaka",
    note: "",
    deliveryCharge: 80,
    items: items.map((item) => ({ ...item, unitPrice: item.unitPrice ?? 500 })),
    website: "",
  };
}

const order = (db: TestD1, items: Parameters<typeof checkout>[0], at = T0) =>
  submitOrder(db, checkout(items), { client: crypto.randomUUID(), limitSecret: "x".repeat(40), now: at });

const change = (id: string, version: number, over: Partial<UpdateOrderInput> = {}): UpdateOrderInput => ({
  id,
  version,
  status: "confirmed",
  paymentStatus: "unpaid",
  note: "",
  ...over,
});

const orderId = (db: TestD1, reference: string) =>
  (db.sqlite.query("SELECT id FROM orders WHERE reference = ?").get(reference) as { id: string }).id;

describe("stock rules", () => {
  test("availability follows the count, and pre-order stays pre-order", () => {
    expect(availabilityFromStock(5, "out_of_stock")).toBe("in_stock");
    expect(availabilityFromStock(0, "in_stock")).toBe("out_of_stock");
    expect(availabilityFromStock(-2, "in_stock")).toBe("out_of_stock");
    expect(availabilityFromStock(-2, "preorder")).toBe("preorder");
    expect(availabilityFromStock(null, "out_of_stock")).toBe("out_of_stock");
    expect(crossesZero(1, 0)).toBe(true);
    expect(crossesZero(0, 2)).toBe(true);
    expect(crossesZero(3, 2)).toBe(false);
    expect(crossesZero(0, -1)).toBe(false);
  });

  test("shortage message says how many are left", () => {
    expect(shortageMessage({ productName: "Mug", variantName: "Sage", stock: 2 })).toContain("only 2 left");
    expect(shortageMessage({ productName: "Mug", variantName: "Sage", stock: 0 })).toContain("no longer available");
  });

  test("stock out and in need a quantity; a first count may be 0", () => {
    const base = { productId: 1, variantId: 1, note: "" };
    expect(adjustStockSchema.safeParse({ ...base, action: "out", quantity: 0 }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, action: "in", quantity: 1.5 }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, action: "start", quantity: 0 }).success).toBe(true);
    expect(adjustStockSchema.safeParse({ ...base, action: "start", quantity: 1, note: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});

describe("migration 0010", () => {
  test("applies on top of an existing database and leaves colours uncounted", () => {
    const files = migrationFiles().filter((name) => name <= "0010_inventory.sql");
    expect(files.at(-1)).toBe("0010_inventory.sql");
    const db = createTestD1({ migrations: files.slice(0, -1) });
    const before = db.sqlite.query("SELECT id, availability FROM product_variants ORDER BY id").all();
    db.sqlite.run(readFileSync(join(import.meta.dir, "../../migrations/0010_inventory.sql"), "utf8"));
    const after = db.sqlite.query("SELECT id, availability, stock FROM product_variants ORDER BY id").all() as {
      id: number;
      availability: string;
      stock: number | null;
    }[];
    expect(after.map(({ stock: _s, ...row }) => row)).toEqual(before as never);
    expect(after.every((row) => row.stock === null)).toBe(true);
    expect(rowsIn(db, "stock_movements")).toBe(0);
  });

  test("the low-stock index repeats LOW_STOCK_LIMIT", () => {
    const sql = readFileSync(join(import.meta.dir, "../../migrations/0010_inventory.sql"), "utf8");
    expect(sql).toContain(`stock <= ${LOW_STOCK_LIMIT}`);
  });
});

describe("adjustStock", () => {
  test("start counting, stock in and stock out move availability and write movements and audit rows", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const [sage] = product.variants;
    expect(await count(db, product.id, sage!.id, 0)).toMatchObject({ stock: 0, availability: "out_of_stock" });
    // A first count of 0 has nothing to record as a movement.
    expect(rowsIn(db, "stock_movements")).toBe(0);

    const stockIn = await adjustStock(
      db,
      owner,
      adjustStockSchema.parse({
        productId: product.id,
        variantId: sage!.id,
        action: "in",
        quantity: 4,
        note: " new batch ",
      }),
      T0,
    );
    expect(stockIn).toMatchObject({ ok: true, stock: 4, availability: "in_stock", availabilityChanged: true });
    const stockOut = await adjustStock(
      db,
      owner,
      adjustStockSchema.parse({ productId: product.id, variantId: sage!.id, action: "out", quantity: 4, note: "" }),
      T0,
    );
    expect(stockOut).toMatchObject({ ok: true, stock: 0, availability: "out_of_stock" });

    const history = await listStockMovements(db, product.id, null);
    expect(history.movements.map((m) => [m.reason, m.delta, m.balanceAfter, m.note, m.variantName])).toEqual([
      ["stock_out", -4, 0, "", "Sage"],
      ["stock_in", 4, 4, "new batch", "Sage"],
    ]);
    const audit = (await listAudit(db)).filter((entry) => entry.action.startsWith("stock."));
    expect(audit.map((entry) => entry.action).sort()).toEqual(["stock.adjusted", "stock.adjusted", "stock.started"]);
  });

  test("stock out never takes a count below 0, and refuses uncounted or already counted colours", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    const input = (action: "start" | "in" | "out", quantity: number) =>
      adjustStockSchema.parse({ productId: product.id, variantId: sage.id, action, quantity, note: "" });

    expect(await adjustStock(db, owner, input("in", 1), T0)).toMatchObject({ ok: false });
    await count(db, product.id, sage.id, 2);
    expect(await adjustStock(db, owner, input("start", 5), T0)).toMatchObject({ ok: false });
    expect(await adjustStock(db, owner, input("out", 3), T0)).toMatchObject({ ok: false });
    expect(stockOf(db, sage.id)).toEqual({ stock: 2, availability: "in_stock" });
    expect(rowsIn(db, "stock_movements")).toBe(1);
    // The refused calls wrote no audit row either.
    expect((await listAudit(db)).filter((entry) => entry.action.startsWith("stock."))).toHaveLength(1);
    // A colour of another product is not found.
    expect(
      await adjustStock(
        db,
        owner,
        adjustStockSchema.parse({ productId: 1, variantId: sage.id, action: "in", quantity: 1, note: "" }),
        T0,
      ),
    ).toMatchObject({ ok: false });
  });

  test("a colour on pre-order stays pre-order at any count", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"], {
      variants: [{ id: null, name: "Sage", swatch: "#ccc", availability: "preorder", images: [IMG] }],
    });
    const sage = product.variants[0]!;
    expect(await count(db, product.id, sage.id, 0)).toMatchObject({ availability: "preorder" });
  });
});

describe("stopCounting", () => {
  const stop = (db: TestD1, productId: number, variantId: number) =>
    stopCounting(db, owner, stopCountingSchema.parse({ productId, variantId }), T0);

  test("a counted colour goes back to NULL, keeps its availability, and leaves an audit row but no movement", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 0);
    await count(db, product.id, plum!.id, 4);
    const movements = rowsIn(db, "stock_movements");

    expect(await stop(db, product.id, sage!.id)).toEqual({ ok: true });
    // Out of stock stays out of stock until the Owner changes it by hand.
    expect(stockOf(db, sage!.id)).toEqual({ stock: null, availability: "out_of_stock" });
    expect(await stop(db, product.id, plum!.id)).toEqual({ ok: true });
    expect(stockOf(db, plum!.id)).toEqual({ stock: null, availability: "in_stock" });
    expect(rowsIn(db, "stock_movements")).toBe(movements);

    const stopped = (await listAudit(db)).filter((entry) => entry.action === "stock.stopped");
    expect(stopped).toHaveLength(2);
    expect(JSON.stringify(stopped.map((entry) => entry.details))).toContain('"lastCount":4');

    // The count can start again afterwards.
    expect(await count(db, product.id, plum!.id, 2)).toMatchObject({ stock: 2 });
  });

  test("a pre-order colour stays pre-order", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"], {
      variants: [{ id: null, name: "Sage", swatch: "#ccc", availability: "preorder", images: [IMG] }],
    });
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 0);
    expect(await stop(db, product.id, sage.id)).toEqual({ ok: true });
    expect(stockOf(db, sage.id)).toEqual({ stock: null, availability: "preorder" });
  });

  test("an uncounted colour, a missing colour or another product's colour is refused and writes no audit row", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    expect(await stop(db, product.id, sage.id)).toMatchObject({ ok: false });
    expect(await stop(db, product.id, 999_999)).toMatchObject({ ok: false });
    await count(db, product.id, sage.id, 3);
    expect(await stop(db, 1, sage.id)).toMatchObject({ ok: false });
    expect(stockOf(db, sage.id).stock).toBe(3);
    expect((await listAudit(db)).filter((entry) => entry.action === "stock.stopped")).toHaveLength(0);
  });

  test("the batch changes nothing when the count moved after the read", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 3);
    // Same statements as stopCounting, with a last count that is no longer true.
    const result = db.sqlite
      .query("UPDATE product_variants AS v SET stock = NULL WHERE v.id = ? AND v.product_id = ? AND v.stock = ?")
      .run(sage.id, product.id, 7);
    expect(result.changes).toBe(0);
    expect(stockOf(db, sage.id).stock).toBe(3);
  });

  test("cancelling and reopening an order whose colour is no longer counted skips it", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 5);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 2 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    expect(stockOf(db, sage.id).stock).toBe(3);
    const movements = rowsIn(db, "stock_movements");

    expect(await stop(db, product.id, sage.id)).toEqual({ ok: true });
    // The order that was already placed is untouched.
    expect(db.sqlite.query("SELECT status FROM orders WHERE id = ?").get(id)).toEqual({ status: "new" });

    expect(await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id)).toEqual({ stock: null, availability: "in_stock" });
    expect(await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id)).toEqual({ stock: null, availability: "in_stock" });
    expect(rowsIn(db, "stock_movements")).toBe(movements);
  });
});

describe("placing an order", () => {
  test("takes exactly the stock that is there, records it, and marks the colour out of stock", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 3);

    const result = await order(db, [
      { productId: product.id, variant: 0, qty: 3 },
      { productId: product.id, variant: 1, qty: 2 },
    ]);
    expect(result).toMatchObject({ ok: true, soldOutProducts: [product.id] });
    expect(stockOf(db, sage!.id)).toEqual({ stock: 0, availability: "out_of_stock" });
    // The uncounted colour is untouched and has no movement.
    expect(stockOf(db, plum!.id)).toEqual({ stock: null, availability: "in_stock" });
    const [movement] = (await listStockMovements(db, product.id, null)).movements;
    expect(movement).toMatchObject({
      reason: "order",
      delta: -3,
      balanceAfter: 0,
      actorUsername: null,
      variantName: "Sage",
    });
    expect(movement!.orderId).toBe(orderId(db, (result as { reference: string }).reference));
  });

  test("one short colour refuses the whole order with 'only N left' and saves nothing", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 5);
    await count(db, product.id, plum!.id, 1);

    const result = await order(db, [
      { productId: product.id, variant: 0, qty: 2 },
      { productId: product.id, variant: 1, qty: 2 },
    ]);
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect((result as { message: string }).message).toContain("only 1 left");
    expect(stockOf(db, sage!.id).stock).toBe(5);
    expect(stockOf(db, plum!.id).stock).toBe(1);
    for (const table of [
      "orders",
      "order_items",
      "order_status_history",
      "order_notification_outbox",
      "daily_totals",
    ]) {
      expect(rowsIn(db, table)).toBe(0);
    }
    expect(rowsIn(db, "stock_movements")).toBe(2); // only the two first counts
  });

  test("a colour that sold out after the lines were read saves nothing (the conditional insert)", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 2);

    const items = checkout([{ productId: product.id, variant: 0, qty: 2 }]).items;
    const selections = await readSelections(db, items as never);
    const selection = selections.get(`${product.id}:0`)!;
    expect(selection.stock).toBe(2);
    // Someone else's order takes the stock between the read and the insert.
    expect(await order(db, [{ productId: product.id, variant: 0, qty: 1 }])).toMatchObject({ ok: true });

    const placed = await insertOrder(db, {
      id: crypto.randomUUID(),
      reference: "CV-AAAAAA",
      idempotencyKey: crypto.randomUUID(),
      payloadHash: "h",
      input: { ...checkout([]), items: items as never, website: "" } as never,
      zone: { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      lines: [{ ...selection, qty: 2, listPrice: selection.unitPrice, discountId: null }],
      itemsTotal: 1000,
      coupon: null,
      subtotal: 1000,
      total: 1080,
      itemCount: 2,
      shopDay: "2026-11-15",
      createdAt: T0.toISOString(),
    });
    expect(placed).toBe(false);
    expect(rowsIn(db, "orders")).toBe(1);
    expect(rowsIn(db, "order_items")).toBe(1);
    expect(stockOf(db, sage.id).stock).toBe(1);
    expect(rowsIn(db, "stock_movements")).toBe(2);
  });

  // Fires once the order INSERT is built, which is after the lines were read and before the statement runs.
  function changeOnOrderInsert(db: TestD1, change: () => void) {
    const prepare = db.prepare.bind(db);
    let done = false;
    db.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (done || !sql.includes("INSERT INTO orders (")) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        if (!done) {
          done = true;
          change();
        }
        return bind(...values);
      };
      return statement;
    };
  }

  test("a colour deleted after the lines were read saves nothing and names the bag", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    changeOnOrderInsert(db, () => {
      db.sqlite.run("DELETE FROM product_variants WHERE id = ?", [product.variants[0]!.id]);
    });
    const result = await order(db, [{ productId: product.id, variant: 0, qty: 1 }]);
    expect(result).toEqual({
      ok: false,
      code: "unavailable",
      message: "A piece in your bag is no longer available. Remove it from your bag and send the order again.",
    });
    expect(rowsIn(db, "orders")).toBe(0);
    expect(rowsIn(db, "order_items")).toBe(0);
    expect(rowsIn(db, "order_notification_outbox")).toBe(0);
  });

  test("a product unpublished after the lines were read saves nothing and names the piece", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    changeOnOrderInsert(db, () => {
      db.sqlite.run("UPDATE products SET status = 'archived' WHERE id = ?", [product.id]);
    });
    const result = await order(db, [{ productId: product.id, variant: 0, qty: 1 }]);
    expect(result).toEqual({
      ok: false,
      code: "unavailable",
      message: `${product.values.name} (Sage) is no longer available. Remove it from your bag and send the order again.`,
    });
    expect(rowsIn(db, "orders")).toBe(0);
  });

  test("a counted pre-order colour may go below 0 and stays pre-order; uncounted colours are not tracked", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"], {
      variants: [{ id: null, name: "Sage", swatch: "#ccc", availability: "preorder", images: [IMG] }],
    });
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 1);
    expect(await order(db, [{ productId: product.id, variant: 0, qty: 3 }])).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id)).toEqual({ stock: -2, availability: "preorder" });

    const plain = await makeProduct(db, ["Sage"]);
    expect(await order(db, [{ productId: plain.id, variant: 0, qty: 3 }])).toMatchObject({ ok: true });
    expect(await listStockMovements(db, plain.id, null)).toEqual({ movements: [], next: null });
  });

  test("an out-of-stock colour is still refused", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"], {
      variants: [{ id: null, name: "Sage", swatch: "#ccc", availability: "out_of_stock", images: [IMG] }],
    });
    expect(await order(db, [{ productId: product.id, variant: 0, qty: 1 }])).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(rowsIn(db, "orders")).toBe(0);
  });
});

describe("cancel and reopen", () => {
  async function counted(stock: number) {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, stock);
    return { db, product, sage };
  }

  test("cancelling returns the stock and reopening takes it again, in the status change's batch", async () => {
    const { db, product, sage } = await counted(3);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 3 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    expect(stockOf(db, sage.id)).toEqual({ stock: 0, availability: "out_of_stock" });

    const cancelled = await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    expect(cancelled).toMatchObject({ ok: true, crossedProducts: [product.id] });
    expect(stockOf(db, sage.id)).toEqual({ stock: 3, availability: "in_stock" });

    const reopened = await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0);
    expect(reopened).toMatchObject({ ok: true, crossedProducts: [product.id] });
    expect(stockOf(db, sage.id)).toEqual({ stock: 0, availability: "out_of_stock" });

    // A second round trip returns the same quantity, not twice.
    await updateOrderStatus(db, owner, change(id, 3, { status: "cancelled" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(3);
    const reasons = (await listStockMovements(db, product.id, null)).movements.map((m) => `${m.reason}:${m.delta}`);
    expect(reasons).toEqual(["order_cancel:3", "order_reopen:-3", "order_cancel:3", "order:-3", "correction:3"]);
  });

  test("cancelling from confirmed or dispatched also returns stock", async () => {
    const { db, product, sage } = await counted(5);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 2 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    await updateOrderStatus(db, owner, change(id, 1), T0);
    await updateOrderStatus(db, owner, change(id, 2, { status: "dispatched" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(3);
    await updateOrderStatus(db, owner, change(id, 3, { status: "cancelled" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(5);
  });

  test("reopening is refused with a clear message while a counted colour is short, and changes nothing", async () => {
    const { db, product, sage } = await counted(2);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 2 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    // The returned pieces are sold to someone else.
    expect(await order(db, [{ productId: product.id, variant: 0, qty: 2 }])).toMatchObject({ ok: true });

    const refused = await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0);
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toMatch(/has 0 left, the order needs 2/);
    expect(db.sqlite.query("SELECT status, version FROM orders WHERE id = ?").get(id)).toEqual({
      status: "cancelled",
      version: 2,
    });
    expect(stockOf(db, sage.id).stock).toBe(0);
    expect((await readReopenShortages(db, id))[0]).toMatchObject({ variantName: "Sage", stock: 0, qty: 2 });

    await adjustStock(
      db,
      owner,
      adjustStockSchema.parse({ productId: product.id, variantId: sage.id, action: "in", quantity: 2, note: "" }),
      T0,
    );
    expect(await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id).stock).toBe(0);
  });

  test("the claim itself refuses a reopen that became short after the check", async () => {
    const { db, product } = await counted(2);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 2 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    await order(db, [{ productId: product.id, variant: 0, qty: 2 }]);
    // Run the claim's conditional SQL directly: it must change nothing.
    const result = db.sqlite
      .query(`UPDATE orders SET status = 'new', version = version + 1 WHERE id = ? AND version = ? AND ${REOPEN_FITS}`)
      .run(id, 2, id);
    expect(result.changes).toBe(0);
  });

  test("stock goes back to the right colour after a save reordered or removed colours", async () => {
    const { db, product, sage } = await counted(4);
    const plum = product.variants[1]!;
    await count(db, product.id, plum.id, 9);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 2 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    expect(stockOf(db, sage.id).stock).toBe(2);

    // Swap the colours: Sage moves from position 0 to 1. The save must not touch either count.
    const current = (await getAdminProduct(db, product.id))!;
    const reordered: ProductFormValues = {
      ...product.values,
      variants: [current.variants[1]!, current.variants[0]!].map((variant) => ({
        id: variant.id,
        name: variant.name,
        swatch: variant.swatch,
        availability: variant.availability,
        images: variant.images,
      })),
    };
    const saved = await saveProduct(db, {
      actor: owner,
      id: product.id,
      revision: current.revision,
      input: productInputSchema.parse(reordered),
    });
    expect(saved).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id).stock).toBe(2);
    expect(stockOf(db, plum.id).stock).toBe(9);

    await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(4);
    expect(stockOf(db, plum.id).stock).toBe(9);

    // Remove Sage entirely: a later reopen has nothing to take and still succeeds; its history keeps the name.
    const after = (await getAdminProduct(db, product.id))!;
    await saveProduct(db, {
      actor: owner,
      id: product.id,
      revision: after.revision,
      input: productInputSchema.parse({
        ...reordered,
        variants: [{ ...reordered.variants[0]! }],
      }),
    });
    expect(await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    const names = (await listStockMovements(db, product.id, null)).movements.map((m) => m.variantName);
    expect(names).toContain("Sage");
  });
});

describe("product save and stock", () => {
  test("a save never writes the count, and a counted colour takes its availability from the count", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 0);
    await count(db, product.id, plum!.id, 6);

    const current = (await getAdminProduct(db, product.id))!;
    expect(current.variants.map((variant) => variant.stock)).toEqual([0, 6]);
    // The editor (with a stale view) says Sage is in stock and Plum out of stock. The counts win.
    const save = (variants: { availability: "in_stock" | "out_of_stock" | "preorder" }[]) =>
      saveProduct(db, {
        actor: owner,
        id: product.id,
        revision: (
          db.sqlite.query("SELECT revision FROM products WHERE id = ?").get(product.id) as { revision: string }
        ).revision,
        input: productInputSchema.parse({
          ...product.values,
          variants: current.variants.map((variant, index) => ({
            id: variant.id,
            name: variant.name,
            swatch: variant.swatch,
            availability: variants[index]!.availability,
            images: variant.images,
          })),
        }),
      });
    expect(await save([{ availability: "in_stock" }, { availability: "out_of_stock" }])).toMatchObject({ ok: true });
    expect(stockOf(db, sage!.id)).toEqual({ stock: 0, availability: "out_of_stock" });
    expect(stockOf(db, plum!.id)).toEqual({ stock: 6, availability: "in_stock" });

    // Pre-order is the one value chosen by hand; clearing it lets the count decide again.
    await save([{ availability: "preorder" }, { availability: "in_stock" }]);
    expect(stockOf(db, sage!.id)).toEqual({ stock: 0, availability: "preorder" });
    await save([{ availability: "in_stock" }, { availability: "in_stock" }]);
    expect(stockOf(db, sage!.id)).toEqual({ stock: 0, availability: "out_of_stock" });

    // An uncounted colour keeps the availability the editor sets.
    const plain = await makeProduct(db, ["Sage"]);
    const plainCurrent = (await getAdminProduct(db, plain.id))!;
    await saveProduct(db, {
      actor: owner,
      id: plain.id,
      revision: plainCurrent.revision,
      input: productInputSchema.parse({
        ...plain.values,
        variants: [{ ...plainCurrent.variants[0]!, availability: "out_of_stock" }],
      }),
    });
    expect(stockOf(db, plain.variants[0]!.id)).toEqual({ stock: null, availability: "out_of_stock" });
  });

  test("a stock change leaves the product revision alone", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    await count(db, product.id, product.variants[0]!.id, 4);
    const revision = (
      db.sqlite.query("SELECT revision FROM products WHERE id = ?").get(product.id) as { revision: string }
    ).revision;
    expect(revision).toBe(product.revision);
  });
});

describe("low stock filter", () => {
  test("lists products with a counted colour at or under the limit, and counts those colours", async () => {
    const db = createTestD1();
    const low = await makeProduct(db, ["Sage", "Plum"]);
    const fine = await makeProduct(db, ["Sage"]);
    const plain = await makeProduct(db, ["Sage"]);
    await count(db, low.id, low.variants[0]!.id, LOW_STOCK_LIMIT);
    await count(db, low.id, low.variants[1]!.id, LOW_STOCK_LIMIT + 1);
    await count(db, fine.id, fine.variants[0]!.id, LOW_STOCK_LIMIT + 1);
    expect(plain.id).toBeGreaterThan(0);

    const page = await listAdminProducts(db, { sort: "updated", lowStock: true });
    expect(page.products.map((product) => product.id)).toEqual([low.id]);
    expect(page.products[0]?.lowStockColours).toBe(1);
    expect(adminProductListSchema.parse({ lowStock: true }).lowStock).toBe(true);
  });
});

describe("query plans (EXPLAIN QUERY PLAN on the real migrations)", () => {
  // Runs a full scenario through a recording wrapper, so every statement the code really sends is checked, with the
  // parameters it really binds.
  const real = createTestD1();
  const seen = new Map<string, unknown[]>();
  const spy: TestD1 = {
    ...real,
    prepare: (sql: string) => {
      const statement = real.prepare(sql);
      if (!seen.has(sql)) seen.set(sql, []);
      return {
        ...statement,
        bind: (...values: unknown[]) => {
          seen.set(sql, values);
          return statement.bind(...values);
        },
      };
    },
    batch: (statements) => real.batch(statements),
  };

  const scenario = async () => {
    const product = await makeProduct(real, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(spy, product.id, sage!.id, 5);
    await count(spy, product.id, plum!.id, 5);
    for (const action of ["in", "out"] as const) {
      await adjustStock(
        spy,
        owner,
        adjustStockSchema.parse({ productId: product.id, variantId: sage!.id, action, quantity: 1, note: "n" }),
        T0,
      );
    }
    const placed = await submitOrder(spy, checkout([{ productId: product.id, variant: 0, qty: 2 }]), {
      client: "c",
      limitSecret: "x".repeat(40),
      now: T0,
    });
    const id = orderId(real, (placed as { reference: string }).reference);
    await updateOrderStatus(spy, owner, change(id, 1, { status: "cancelled" }), T0);
    await updateOrderStatus(spy, owner, change(id, 2, { status: "new" }), T0);
    await stopCounting(spy, owner, stopCountingSchema.parse({ productId: product.id, variantId: plum!.id }), T0);
    await readReopenShortages(spy, id);
    await readCrossedProducts(spy, id, T0.toISOString());
    const first = await listStockMovements(spy, product.id, null);
    await listStockMovements(spy, product.id, { createdAt: first.movements[0]!.createdAt, id: first.movements[0]!.id });
    await listAdminProducts(spy, { sort: "updated", lowStock: true });
  };

  const explain = (sql: string, params: unknown[]) =>
    (real.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
      (row) => row.detail,
    );

  test("no statement scans a growing table or builds a temp B-tree", async () => {
    await scenario();
    const touched = [...seen].filter(([sql]) => /stock_movements|product_variants|FROM json_each/.test(sql));
    expect(touched.length).toBeGreaterThan(15);
    for (const [sql, params] of touched) {
      const details = explain(sql, params);
      if (process.env.SHOW_PLANS) {
        console.log(sql.replace(/\s+/g, " ").slice(0, 110));
        for (const detail of details) console.log(`    ${detail}`);
      }
      // A SCAN may only read a json_each list, a one-row VALUES, or a subquery built from one.
      const bad = details.filter(
        (detail) =>
          /USE TEMP B-TREE/.test(detail) ||
          (/^SCAN /.test(detail) && !/^SCAN (j|m|CONSTANT ROW|\(subquery)/.test(detail)),
      );
      expect({ sql: sql.replace(/\s+/g, " ").slice(0, 100), bad }).toEqual({
        sql: sql.replace(/\s+/g, " ").slice(0, 100),
        bad: [],
      });
    }
  });

  test("stopping the count is a primary key lookup", async () => {
    if (seen.size === 0) await scenario();
    const [sql, params] = [...seen].find(([text]) => /SET stock = NULL/.test(text))!;
    const details = explain(sql, params);
    expect(details.join(" ")).toMatch(/SEARCH v USING INTEGER PRIMARY KEY \(rowid=\?\)/);
    expect(details.some((detail) => /^SCAN|TEMP B-TREE/.test(detail))).toBe(false);
  });

  test("the low-stock list query uses the partial index", () => {
    const [statement] = buildListStatements({ sort: "updated", lowStock: true });
    const details = explain(statement!.sql, statement!.params);
    expect(details.join("\n")).toContain("idx_variants_low_stock");
    expect(details.some((detail) => /^SCAN products|TEMP B-TREE/.test(detail))).toBe(false);
  });
});

describe("a recount does not count an old order twice", () => {
  const stop = (db: TestD1, productId: number, variantId: number) =>
    stopCounting(db, owner, stopCountingSchema.parse({ productId, variantId }), T0);

  test("order 5, stop counting, count again at 10, cancel the old order: the count stays 10", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 8);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 5 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    expect(stockOf(db, sage.id).stock).toBe(3);

    expect(await stop(db, product.id, sage.id)).toEqual({ ok: true });
    // A real recount of the shelf.
    await count(db, product.id, sage.id, 10);
    const movements = rowsIn(db, "stock_movements");

    expect(await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id)).toEqual({ stock: 10, availability: "in_stock" });
    expect(rowsIn(db, "stock_movements")).toBe(movements);

    // Reopening takes nothing either, because the cancel returned nothing under this count.
    expect(await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id).stock).toBe(10);
    expect(rowsIn(db, "stock_movements")).toBe(movements);
  });

  test("an order placed after the recount is returned and taken again as usual", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 8);
    const old = (await order(db, [{ productId: product.id, variant: 0, qty: 5 }])) as { reference: string };
    await stop(db, product.id, sage.id);
    await count(db, product.id, sage.id, 10);
    const fresh = (await order(db, [{ productId: product.id, variant: 0, qty: 4 }])) as { reference: string };
    const freshId = orderId(db, fresh.reference);
    expect(stockOf(db, sage.id).stock).toBe(6);

    expect(await updateOrderStatus(db, owner, change(freshId, 1, { status: "cancelled" }), T0)).toMatchObject({
      ok: true,
    });
    expect(stockOf(db, sage.id).stock).toBe(10);
    expect(await updateOrderStatus(db, owner, change(freshId, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id).stock).toBe(6);
    // The old order still moves nothing.
    const oldId = orderId(db, old.reference);
    await updateOrderStatus(db, owner, change(oldId, 1, { status: "cancelled" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(6);
  });

  test("a cancel made under the old count is not taken back by a reopen under the new one", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 8);
    const placed = (await order(db, [{ productId: product.id, variant: 0, qty: 5 }])) as { reference: string };
    const id = orderId(db, placed.reference);
    await updateOrderStatus(db, owner, change(id, 1, { status: "cancelled" }), T0);
    expect(stockOf(db, sage.id).stock).toBe(8);
    await stop(db, product.id, sage.id);
    await count(db, product.id, sage.id, 2);
    // Reopening would have taken 5 from a count of 2 and been refused; now it has nothing to take.
    expect(await updateOrderStatus(db, owner, change(id, 2, { status: "new" }), T0)).toMatchObject({ ok: true });
    expect(stockOf(db, sage.id).stock).toBe(2);
  });

  test("without a recount, the epoch changes nothing: stopping once and never restarting still skips the colour", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage"]);
    const sage = product.variants[0]!;
    await count(db, product.id, sage.id, 5);
    expect(db.sqlite.query("SELECT count_epoch FROM product_variants WHERE id = ?").get(sage.id)).toEqual({
      count_epoch: 0,
    });
    await stop(db, product.id, sage.id);
    expect(db.sqlite.query("SELECT count_epoch FROM product_variants WHERE id = ?").get(sage.id)).toEqual({
      count_epoch: 1,
    });
    await count(db, product.id, sage.id, 4);
    const movementEpochs = db.sqlite.query("SELECT DISTINCT count_epoch FROM stock_movements ORDER BY 1").all();
    expect(movementEpochs).toEqual([{ count_epoch: 0 }, { count_epoch: 1 }]);
  });
});

describe("stock is reserved by colour id", () => {
  test("a product save that renumbers the colours between the read and the order saves the order on the right colour", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 5);
    await count(db, product.id, plum!.id, 5);

    // The shopper's read: position 0 is Sage.
    const items = checkout([{ productId: product.id, variant: 0, qty: 2 }]).items;
    const selection = (await readSelections(db, items as never)).get(`${product.id}:0`)!;
    expect(selection).toMatchObject({ variantName: "Sage", variantId: sage!.id });

    // The Owner swaps the colours: Plum is now position 0.
    const current = (await getAdminProduct(db, product.id))!;
    const saved = await saveProduct(db, {
      actor: owner,
      id: product.id,
      revision: current.revision,
      input: productInputSchema.parse({
        ...product.values,
        variants: [current.variants[1]!, current.variants[0]!].map((variant) => ({
          id: variant.id,
          name: variant.name,
          swatch: variant.swatch,
          availability: variant.availability,
          images: variant.images,
        })),
      }),
    });
    expect(saved).toMatchObject({ ok: true });

    const placed = await insertOrder(db, {
      id: crypto.randomUUID(),
      reference: "CV-BBBBBB",
      idempotencyKey: crypto.randomUUID(),
      payloadHash: "h",
      input: { ...checkout([]), items: items as never, website: "" } as never,
      zone: { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      lines: [{ ...selection, qty: 2, listPrice: selection.unitPrice, discountId: null }],
      itemsTotal: 1000,
      coupon: null,
      subtotal: 1000,
      total: 1080,
      itemCount: 2,
      shopDay: "2026-11-15",
      createdAt: T0.toISOString(),
    });
    expect(placed).toBe(true);
    // Sage (the colour the shopper chose) lost 2; Plum, now at position 0, lost nothing.
    expect(stockOf(db, sage!.id).stock).toBe(3);
    expect(stockOf(db, plum!.id).stock).toBe(5);
    const movement = db.sqlite
      .query("SELECT variant_id, variant_name, delta FROM stock_movements WHERE reason = 'order'")
      .get();
    expect(movement).toEqual({ variant_id: sage!.id, variant_name: "Sage", delta: -2 });
  });

  test("the short-line check follows the colour id too", async () => {
    const db = createTestD1();
    const product = await makeProduct(db, ["Sage", "Plum"]);
    const [sage, plum] = product.variants;
    await count(db, product.id, sage!.id, 1);
    await count(db, product.id, plum!.id, 9);
    const items = checkout([{ productId: product.id, variant: 0, qty: 3 }]).items;
    const selection = (await readSelections(db, items as never)).get(`${product.id}:0`)!;
    // The read said Sage (1 left), so the insert must refuse 3 of it even if position 0 now holds Plum (9 left).
    db.sqlite.run("UPDATE product_variants SET position = 9 WHERE id = ?", [sage!.id]);
    db.sqlite.run("UPDATE product_variants SET position = 0 WHERE id = ?", [plum!.id]);
    db.sqlite.run("UPDATE product_variants SET position = 1 WHERE id = ?", [sage!.id]);
    const placed = await insertOrder(db, {
      id: crypto.randomUUID(),
      reference: "CV-CCCCCC",
      idempotencyKey: crypto.randomUUID(),
      payloadHash: "h",
      input: { ...checkout([]), items: items as never, website: "" } as never,
      zone: { id: "inside-dhaka", name: "Inside Dhaka", charge: 80 },
      lines: [{ ...selection, qty: 3, listPrice: selection.unitPrice, discountId: null }],
      itemsTotal: 1500,
      coupon: null,
      subtotal: 1500,
      total: 1580,
      itemCount: 3,
      shopDay: "2026-11-15",
      createdAt: T0.toISOString(),
    });
    expect(placed).toBe(false);
    expect(stockOf(db, sage!.id).stock).toBe(1);
    expect(stockOf(db, plum!.id).stock).toBe(9);
  });
});

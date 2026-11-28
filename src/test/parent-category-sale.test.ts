import { describe, expect, test } from "bun:test";
import { priceSummary, toSummary } from "@/domain/catalog-snapshot";
import { bestSale, priceFor, type SaleRule, saleCovers } from "@/domain/discounts";
import type { CheckoutRequest } from "@/domain/orders";
import { readPublishedCatalog } from "@/server/db/catalog.repository";
import { checkCoupon } from "@/server/services/coupons.service";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const NOW = Date.parse("2026-11-15T06:00:00.000Z");
const T0 = new Date(NOW);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = "x".repeat(40);

function makeRule(over: Partial<SaleRule> = {}): SaleRule {
  return {
    id: 1,
    scope: "category",
    categoryId: "drinkware",
    productId: null,
    type: "percent",
    value: 20,
    startsAt: iso(NOW - HOUR),
    endsAt: iso(NOW + HOUR),
    ...over,
  };
}

function addSale(db: TestD1, over: Partial<Record<string, unknown>> = {}): number {
  const row = {
    name: "Drinkware Sale",
    scope: "category",
    category_id: "drinkware",
    product_id: null,
    type: "percent",
    value: 20,
    starts_at: iso(NOW - HOUR),
    ends_at: iso(NOW + HOUR),
    active: 1,
    ...over,
  };
  const result = db.sqlite
    .query(
      `INSERT INTO discounts (name, kind, scope, category_id, product_id, type, value, starts_at, ends_at, active,
         created_at, updated_at, revision)
       VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.name as string,
      row.scope as string,
      row.category_id as string | null,
      row.product_id as number | null,
      row.type as string,
      row.value as number,
      row.starts_at as string,
      row.ends_at as string | null,
      row.active as number,
      iso(NOW),
      iso(NOW),
      crypto.randomUUID(),
    );
  return Number(result.lastInsertRowid);
}

function addCoupon(db: TestD1, over: Partial<Record<string, unknown>> = {}): number {
  const row = {
    code: "EXTRA10",
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

/** Creates subcategory `mugs` under `drinkware` and moves one published in-stock product into it. */
function setupSubcategoryProduct(db: TestD1) {
  db.sqlite
    .query(
      `INSERT INTO categories (id, name, slug, description, image, parent_id, sort, active)
       VALUES ('mugs', 'Mugs', 'mugs', 'Ceramic mugs', '', 'drinkware', 10, 1)`,
    )
    .run();
  const product = db.sqlite
    .query(
      `SELECT p.id, p.slug, p.price FROM products p
       JOIN product_variants v ON v.product_id = p.id AND v.position = 0 AND v.availability = 'in_stock'
       WHERE p.status = 'published' AND p.category_id = 'drinkware' ORDER BY p.id LIMIT 1`,
    )
    .get() as { id: number; slug: string; price: number };
  db.sqlite.query("UPDATE products SET category_id = 'mugs', price = 1000 WHERE id = ?").run(product.id);
  return { ...product, price: 1000, category: "mugs" };
}

function checkoutRequest(
  items: { productId: number; variant: number; qty: number; unitPrice: number }[],
  over: Partial<CheckoutRequest> = {},
): CheckoutRequest {
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "Test Customer",
    phone: "01712345678",
    zoneId: "inside-dhaka",
    address: "House 1, Road 2, Dhanmondi, Dhaka",
    note: "",
    deliveryCharge: 80 + 20 * Math.max(0, items.reduce((sum, item) => sum + item.qty, 0) - 1),
    items,
    website: "",
    ...over,
  };
}

describe("M6: parent category sales apply to subcategory products", () => {
  test("saleCovers, bestSale, and priceFor match parent category sales for subcategory products", () => {
    const parentSale = makeRule({ id: 10, scope: "category", categoryId: "drinkware", value: 20 });
    const subSale = makeRule({ id: 11, scope: "category", categoryId: "mugs", value: 30 });
    const mug = { id: 7, category: "mugs", parentCategoryId: "drinkware" };
    const tumbler = { id: 8, category: "tumblers", parentCategoryId: "drinkware" };
    const plate = { id: 9, category: "plates", parentCategoryId: "serveware" };

    expect(saleCovers(parentSale, mug)).toBe(true);
    expect(saleCovers(parentSale, plate)).toBe(false);
    expect(saleCovers(subSale, mug)).toBe(true);
    expect(saleCovers(subSale, tumbler)).toBe(false);

    expect(bestSale([parentSale], mug, 1000, NOW)).toMatchObject({ price: 800, rule: parentSale });
    expect(priceFor([parentSale], mug, 1000, NOW)).toEqual({ price: 800, listPrice: 1000, saleId: 10 });
    expect(bestSale([parentSale], plate, 1000, NOW)).toBeNull();
  });

  test("catalog-snapshot priceSummary applies parent category sale to subcategory products", async () => {
    const db = createTestD1();
    const mug = setupSubcategoryProduct(db);
    addSale(db, { scope: "category", category_id: "drinkware", type: "percent", value: 20 });

    const summary = toSummary(await readPublishedCatalog(db, T0), "g");
    const priced = priceSummary(summary, NOW);

    const mugCard = priced.products.find((p) => p.id === mug.id);
    expect(mugCard).toBeDefined();
    expect(mugCard!.price).toBe(800);
    expect(mugCard!.regularPrice).toBe(1000);
    expect(mugCard!.sale).toMatchObject({ listPrice: 1000, badge: "20% off" });

    const servewareCard = priced.products.find((p) => p.category === "serveware");
    expect(servewareCard).toBeDefined();
    expect(servewareCard!.sale).toBeUndefined();
  });

  test("submitOrder charges the parent category sale price for a subcategory product", async () => {
    const db = createTestD1();
    const mug = setupSubcategoryProduct(db);
    const saleId = addSale(db, { scope: "category", category_id: "drinkware", type: "percent", value: 20 });

    const result = await submitOrder(db, checkoutRequest([{ productId: mug.id, variant: 0, qty: 1, unitPrice: 800 }]), {
      client: crypto.randomUUID(),
      limitSecret: SECRET,
      now: T0,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.total).toBe(880);
    expect(db.sqlite.query("SELECT unit_price, list_price, discount_id, line_total FROM order_items").get()).toEqual({
      unit_price: 800,
      list_price: 1000,
      discount_id: saleId,
      line_total: 800,
    });
  });

  test("an inactive parent's sale does not price its subcategory products at checkout", async () => {
    const db = createTestD1();
    const mug = setupSubcategoryProduct(db);
    addSale(db, { scope: "category", category_id: "drinkware", type: "percent", value: 20 });
    db.sqlite.query("UPDATE categories SET active = 0 WHERE id = 'drinkware'").run();

    const result = await submitOrder(
      db,
      checkoutRequest([{ productId: mug.id, variant: 0, qty: 1, unitPrice: 1000 }]),
      { client: crypto.randomUUID(), limitSecret: SECRET, now: T0 },
    );
    if (!result.ok) throw new Error(result.message);
    expect(db.sqlite.query("SELECT unit_price, discount_id FROM order_items").get()).toEqual({
      unit_price: 1000,
      discount_id: null,
    });
  });

  test("checkCoupon computes itemsTotal after the parent category sale for a subcategory product", async () => {
    const db = createTestD1();
    const mug = setupSubcategoryProduct(db);
    addSale(db, { scope: "category", category_id: "drinkware", type: "percent", value: 20 });
    addCoupon(db, { code: "EXTRA10", type: "percent", value: 10 });

    const preview = await checkCoupon(
      db,
      { code: "EXTRA10", items: [{ productId: mug.id, variant: 0, qty: 1 }] },
      { client: crypto.randomUUID(), limitSecret: SECRET, now: T0 },
    );
    // 1000 list -> 800 after 20% drinkware sale -> 10% coupon = 80 off, subtotal 720.
    expect(preview).toMatchObject({
      ok: true,
      code: "EXTRA10",
      discount: 80,
      subtotal: 720,
    });
  });
});

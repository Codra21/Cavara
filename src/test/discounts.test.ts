import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  decodeSummary,
  encodeSummary,
  priceDetail,
  priceProduct,
  priceSummary,
  type ProductDetail,
  toProductSummary,
  toSummary,
} from "@/domain/catalog-snapshot";
import {
  bestSale,
  dhakaLocalToIso,
  discountInputSchema,
  isoToDhakaLocal,
  priceFor,
  type SaleRule,
  saleBadge,
  saleState,
  saleUnitPrice,
  strikePrice,
} from "@/domain/discounts";
import { listProducts } from "@/domain/product-listing";
import { type CheckoutRequest } from "@/domain/orders";
import { listAudit } from "@/server/admin/auth.server";
import { updateOrderStatus } from "@/server/db/admin-orders.repository";
import { listDiscounts, LIST_DISCOUNTS_SQL, saveDiscount } from "@/server/db/admin-discounts.repository";
import { LIVE_SALES_SQL, readLiveSales, readPublishedCatalog } from "@/server/db/catalog.repository";
import {
  type CatalogSources,
  getCatalogSummary,
  invalidateCatalogCache,
  refreshSales,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import { getProductBySlug, getProductsByIds } from "@/server/catalog-queries.server";
import { submitOrder } from "@/server/services/orders.service";
import { FakeStore, installFakeCache, meteredD1, removeFakeCache } from "./helpers/catalog-doubles";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const NOW = Date.parse("2026-11-15T06:00:00.000Z");
const T0 = new Date(NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

let nextId = 1;
const rule = (over: Partial<SaleRule> = {}): SaleRule => ({
  id: nextId++,
  scope: "all",
  categoryId: null,
  productId: null,
  type: "percent",
  value: 20,
  startsAt: iso(NOW - HOUR),
  endsAt: iso(NOW + HOUR),
  ...over,
});
const mug = { id: 7, category: "drinkware" };

describe("the price rule", () => {
  test("a percent sale rounds the discount down to whole taka", () => {
    expect(saleUnitPrice(999, { type: "percent", value: 20 })).toBe(999 - 199); // 199.8 off becomes 199
    expect(saleUnitPrice(1000, { type: "percent", value: 15 })).toBe(850);
    expect(saleUnitPrice(5, { type: "percent", value: 10 })).toBe(5); // 0.5 rounds to nothing off
  });

  test("an amount sale takes the amount off; the charged price is never below 1", () => {
    expect(saleUnitPrice(500, { type: "amount", value: 100 })).toBe(400);
    expect(saleUnitPrice(500, { type: "amount", value: 900 })).toBe(1);
    expect(saleUnitPrice(5, { type: "percent", value: 99 })).toBe(1);
    expect(saleUnitPrice(500, { type: "amount", value: 499 })).toBe(1);
  });

  test("a sale that would not lower the price does not apply", () => {
    expect(bestSale([rule({ type: "amount", value: 100 })], mug, 1, NOW)).toBeNull();
    expect(bestSale([rule({ type: "percent", value: 10 })], mug, 5, NOW)).toBeNull();
  });

  test("dates: starts inclusive, ends exclusive, open-ended, and a bad date never applies", () => {
    const sale = (startsAt: string, endsAt: string | null) => [rule({ startsAt, endsAt })];
    expect(bestSale(sale(iso(NOW), iso(NOW + 1)), mug, 500, NOW)).not.toBeNull();
    expect(bestSale(sale(iso(NOW + 1), null), mug, 500, NOW)).toBeNull();
    expect(bestSale(sale(iso(NOW - HOUR), iso(NOW)), mug, 500, NOW)).toBeNull();
    expect(bestSale(sale(iso(NOW - HOUR), iso(NOW + 1)), mug, 500, NOW)).not.toBeNull();
    expect(bestSale(sale(iso(NOW - HOUR), null), mug, 500, NOW + 365 * 24 * HOUR)).not.toBeNull();
    expect(bestSale(sale("not a date", null), mug, 500, NOW)).toBeNull();
  });

  test("scopes: a category sale covers only its category, a product sale only its product, all covers everything", () => {
    const cups = rule({ scope: "category", categoryId: "cups", value: 50 });
    const thisMug = rule({ scope: "product", productId: 7, value: 40 });
    const shop = rule({ scope: "all", value: 10 });
    expect(bestSale([cups], mug, 1000, NOW)).toBeNull();
    expect(bestSale([cups], { id: 8, category: "cups" }, 1000, NOW)?.price).toBe(500);
    expect(bestSale([thisMug], { id: 8, category: "drinkware" }, 1000, NOW)).toBeNull();
    expect(bestSale([thisMug], mug, 1000, NOW)?.price).toBe(600);
    expect(bestSale([shop], mug, 1000, NOW)?.price).toBe(900);
  });

  test("the best sale wins and they never stack", () => {
    const shop = rule({ scope: "all", value: 20 });
    const category = rule({ scope: "category", categoryId: "drinkware", value: 30 });
    const product = rule({ scope: "product", productId: 7, type: "amount", value: 100 });
    // 20% off 500 is 400, 30% is 350, 100 off is 400: the category sale gives the lowest price.
    expect(bestSale([shop, category, product], mug, 500, NOW)).toMatchObject({ price: 350, rule: category });
    // Take the category sale away: the shop-wide and product sales tie at 400 and the narrower scope wins.
    expect(bestSale([shop, product], mug, 500, NOW)).toMatchObject({ price: 400, rule: product });
    // Same price and scope: the lower id wins, whatever the order of the list.
    const a = rule({ value: 20 });
    const b = rule({ value: 20 });
    expect(bestSale([b, a], mug, 500, NOW)?.rule.id).toBe(Math.min(a.id, b.id));
  });

  test("priceFor returns the list price when nothing applies", () => {
    expect(priceFor([], mug, 500, NOW)).toEqual({ price: 500, listPrice: 500, saleId: null });
    const sale = rule({ value: 10 });
    expect(priceFor([sale], mug, 500, NOW)).toEqual({ price: 450, listPrice: 500, saleId: sale.id });
  });

  test("the struck price is the higher of the pre-sale price and the manual regular price", () => {
    expect(strikePrice(500, null)).toBe(500);
    expect(strikePrice(500, 900)).toBe(900);
    expect(strikePrice(500, 400)).toBe(500);
  });

  test("badge text rounds the percentage down and falls back to Sale", () => {
    expect(saleBadge(500, 400)).toBe("20% off");
    expect(saleBadge(999, 800)).toBe("19% off");
    expect(saleBadge(1000, 999)).toBe("Sale");
  });

  test("states for the admin list", () => {
    const base = { active: true, startsAt: iso(NOW - HOUR), endsAt: iso(NOW + HOUR) };
    expect(saleState(base, NOW)).toBe("live");
    expect(saleState({ ...base, active: false }, NOW)).toBe("off");
    expect(saleState({ ...base, startsAt: iso(NOW + 1) }, NOW)).toBe("upcoming");
    expect(saleState({ ...base, endsAt: iso(NOW) }, NOW)).toBe("ended");
    expect(saleState({ ...base, endsAt: null }, NOW)).toBe("live");
  });
});

describe("Dhaka time", () => {
  test("a datetime-local value is UTC+6", () => {
    expect(dhakaLocalToIso("2026-11-20T09:30")).toBe("2026-11-20T03:30:00.000Z");
    expect(dhakaLocalToIso("2026-11-20T02:00")).toBe("2026-11-19T20:00:00.000Z");
    expect(isoToDhakaLocal("2026-11-19T20:00:00.000Z")).toBe("2026-11-20T02:00");
    expect(dhakaLocalToIso("")).toBeNull();
    expect(dhakaLocalToIso("2026-13-45T99:99")).toBeNull();
  });
});

describe("discountInputSchema", () => {
  const valid = {
    name: "  Eid   sale ",
    scope: "all" as const,
    categoryId: "stale",
    productId: 4,
    type: "percent" as const,
    value: 20,
    startsAt: "2026-11-20T03:30:00.000Z",
    endsAt: null,
    active: true,
  };

  test("cleans the name and drops fields that do not belong to the scope", () => {
    const parsed = discountInputSchema.parse(valid);
    expect(parsed).toMatchObject({ name: "Eid sale", categoryId: null, productId: null });
  });

  test("rejects a year outside 2000 to 9999 and an overlong date string", () => {
    const fails = (over: object) => discountInputSchema.safeParse({ ...valid, ...over }).success === false;
    expect(fails({ startsAt: "1999-12-31T23:59:59.000Z" })).toBe(true);
    expect(fails({ endsAt: "+010000-01-01T00:00:00.000Z" })).toBe(true);
    expect(fails({ endsAt: "2026-12-01T00:00:00.000Z" + " ".repeat(40) })).toBe(true);
    expect(fails({ startsAt: "2000-01-01T00:00:00.000Z", endsAt: "9999-12-31T23:59:59.000Z" })).toBe(false);
  });

  test("rejects 100 percent, a category sale without a category, and an end before the start", () => {
    const fails = (over: object) => discountInputSchema.safeParse({ ...valid, ...over }).success === false;
    expect(fails({ value: 100 })).toBe(true);
    expect(fails({ value: 0 })).toBe(true);
    expect(fails({ value: 1.5 })).toBe(true);
    expect(fails({ value: Number.NaN })).toBe(true);
    expect(fails({ scope: "category", categoryId: null })).toBe(true);
    expect(fails({ scope: "product", productId: null })).toBe(true);
    expect(fails({ endsAt: "2026-11-20T03:30:00.000Z" })).toBe(true);
    expect(fails({ startsAt: "" })).toBe(true);
    expect(fails({ name: "   " })).toBe(true);
    expect(fails({ type: "amount", value: 100 })).toBe(false);
  });

  test("normalises dates to one ISO form", () => {
    const parsed = discountInputSchema.parse({ ...valid, startsAt: "2026-11-20T09:30:00+06:00" });
    expect(parsed.startsAt).toBe("2026-11-20T03:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** Inserts a sale straight into D1, as an admin save would. */
function addSale(db: TestD1, over: Partial<Record<string, unknown>> = {}): number {
  const row = {
    name: "Sale",
    scope: "all",
    category_id: null,
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

/** A published product with an in-stock first colour from the seed. */
function pick(db: TestD1, category?: string) {
  return db.sqlite
    .query(
      `SELECT p.id, p.slug, p.category_id AS category, p.price FROM products p
       JOIN product_variants v ON v.product_id = p.id AND v.position = 0 AND v.availability = 'in_stock'
       WHERE p.status = 'published' AND (? IS NULL OR p.category_id = ?) ORDER BY p.id LIMIT 1`,
    )
    .get(category ?? null, category ?? null) as { id: number; slug: string; category: string; price: number };
}

function checkout(items: { productId: number; variant: number; qty: number; unitPrice: number }[]): CheckoutRequest {
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
  };
}

const place = (db: TestD1, items: Parameters<typeof checkout>[0], at = T0) =>
  submitOrder(db, checkout(items), { client: crypto.randomUUID(), limitSecret: "x".repeat(40), now: at });

describe("checkout", () => {
  test("charges the sale price and stores the list price and the sale", async () => {
    const db = createTestD1();
    const product = pick(db);
    const saleId = addSale(db, { scope: "all", type: "percent", value: 20 });
    const charged = product.price - Math.floor((product.price * 20) / 100);

    const result = await place(db, [{ productId: product.id, variant: 0, qty: 2, unitPrice: charged }]);
    if (!result.ok) throw new Error(result.message);
    expect(result.total).toBe(charged * 2 + 100);
    expect(db.sqlite.query("SELECT subtotal, total FROM orders").get()).toEqual({
      subtotal: charged * 2,
      total: charged * 2 + 100,
    });
    expect(db.sqlite.query("SELECT unit_price, list_price, discount_id, line_total FROM order_items").get()).toEqual({
      unit_price: charged,
      list_price: product.price,
      discount_id: saleId,
      line_total: charged * 2,
    });
  });

  test("a client that sends the old price gets price_changed with the sale price, and nothing is saved", async () => {
    const db = createTestD1();
    const product = pick(db);
    addSale(db, { type: "amount", value: 50 });
    const result = await place(db, [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }]);
    expect(result).toMatchObject({
      ok: false,
      code: "price_changed",
      prices: [{ productId: product.id, variant: 0, unitPrice: product.price - 50 }],
    });
    expect(db.sqlite.query("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 0 });
  });

  test("a sale that has ended is not charged, and the shopper who saw it is told the price changed", async () => {
    const db = createTestD1();
    const product = pick(db);
    addSale(db, { type: "amount", value: 50, ends_at: iso(NOW + HOUR) });
    const later = new Date(NOW + 2 * HOUR);
    const seen = await place(db, [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price - 50 }], later);
    expect(seen).toMatchObject({ ok: false, code: "price_changed" });
    const fresh = await place(db, [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }], later);
    expect(fresh.ok).toBe(true);
    expect(db.sqlite.query("SELECT unit_price, list_price, discount_id FROM order_items").get()).toEqual({
      unit_price: product.price,
      list_price: product.price,
      discount_id: null,
    });
  });

  test("an upcoming sale and a switched-off sale are not charged", async () => {
    const db = createTestD1();
    const product = pick(db);
    addSale(db, { starts_at: iso(NOW + HOUR), ends_at: null });
    addSale(db, { active: 0 });
    const result = await place(db, [{ productId: product.id, variant: 0, qty: 1, unitPrice: product.price }]);
    expect(result.ok).toBe(true);
  });

  test("the best of a product, a category and a shop-wide sale is charged, per line", async () => {
    const db = createTestD1();
    const product = pick(db);
    addSale(db, { scope: "all", type: "percent", value: 10 });
    const category = addSale(db, { scope: "category", category_id: product.category, type: "percent", value: 30 });
    addSale(db, { scope: "product", product_id: product.id + 999, type: "percent", value: 90 }); // another product
    const charged = product.price - Math.floor((product.price * 30) / 100);
    const result = await place(db, [{ productId: product.id, variant: 0, qty: 1, unitPrice: charged }]);
    expect(result.ok).toBe(true);
    expect(db.sqlite.query("SELECT discount_id FROM order_items").get()).toEqual({ discount_id: category });
  });

  test("profit and revenue follow the charged price", async () => {
    const db = createTestD1();
    const product = pick(db);
    db.sqlite.run("UPDATE products SET cost_price = 100 WHERE id = ?", [product.id]);
    addSale(db, { type: "amount", value: 50 });
    const charged = product.price - 50;
    const placed = await place(db, [{ productId: product.id, variant: 0, qty: 2, unitPrice: charged }]);
    if (!placed.ok) throw new Error(placed.message);
    const id = (db.sqlite.query("SELECT id FROM orders").get() as { id: string }).id;
    const changed = await updateOrderStatus(
      db,
      owner,
      { id, version: 1, status: "confirmed", paymentStatus: "unpaid", note: "" },
      T0,
    );
    expect(changed.ok).toBe(true);
    expect(db.sqlite.query("SELECT revenue, profit FROM daily_totals").get()).toEqual({
      revenue: charged * 2,
      profit: (charged - 100) * 2,
    });
  });
});

describe("admin save", () => {
  const input = (over: object = {}) =>
    discountInputSchema.parse({
      name: "Eid sale",
      scope: "all",
      categoryId: null,
      productId: null,
      type: "percent",
      value: 20,
      startsAt: iso(NOW),
      endsAt: iso(NOW + HOUR),
      active: true,
      ...over,
    });

  test("creates a sale with its audit row, then updates it by revision", async () => {
    const db = createTestD1();
    const created = await saveDiscount(db, owner, { id: null, revision: "", input: input() }, T0);
    if (!created.ok) throw new Error(created.error);
    expect(created.discount).toMatchObject({ name: "Eid sale", active: true, scope: "all", value: 20 });

    const updated = await saveDiscount(
      db,
      owner,
      { id: created.discount.id, revision: created.discount.revision, input: input({ value: 25, active: false }) },
      T0,
    );
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.discount).toMatchObject({ value: 25, active: false });
    expect(updated.discount.revision).not.toBe(created.discount.revision);

    const audit = await listAudit(db);
    expect(audit.map((entry) => entry.action).sort()).toEqual(["discount.created", "discount.updated"]);
    expect(audit.every((entry) => entry.targetId === String(created.discount.id))).toBe(true);
  });

  test("a stale revision changes nothing and writes no audit row", async () => {
    const db = createTestD1();
    const created = await saveDiscount(db, owner, { id: null, revision: "", input: input() }, T0);
    if (!created.ok) throw new Error(created.error);
    const stale = await saveDiscount(
      db,
      owner,
      { id: created.discount.id, revision: "old", input: input({ value: 50 }) },
      T0,
    );
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((await listDiscounts(db))[0]?.value).toBe(20);
    expect((await listAudit(db)).length).toBe(1);
  });

  test("refuses a category or product that does not exist, and a product sale shows the product's name", async () => {
    const db = createTestD1();
    expect(
      await saveDiscount(db, owner, {
        id: null,
        revision: "",
        input: input({ scope: "category", categoryId: "nope" }),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await saveDiscount(db, owner, { id: null, revision: "", input: input({ scope: "product", productId: 99999 }) }),
    ).toMatchObject({ ok: false });
    const product = pick(db);
    const saved = await saveDiscount(db, owner, {
      id: null,
      revision: "",
      input: input({ scope: "product", productId: product.id }),
    });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.discount.targetName).toBeTruthy();
    expect((await listDiscounts(db))[0]?.targetName).toBe(saved.discount.targetName);
  });

  test("the table refuses a row whose scope and targets disagree", () => {
    const db = createTestD1();
    expect(() => addSale(db, { scope: "category", category_id: null })).toThrow();
    expect(() => addSale(db, { scope: "all", product_id: 3 })).toThrow();
    expect(() => addSale(db, { ends_at: iso(NOW - 2 * HOUR) })).toThrow();
  });
});

function detailProduct(over: Partial<ProductDetail>): ProductDetail {
  return {
    id: 1,
    slug: "mug",
    name: "Mug",
    category: "drinkware",
    price: 500,
    regularPrice: null,
    featured: false,
    createdAt: "2026-11-01",
    sort: 1,
    summary: "",
    details: [],
    note: null,
    variants: [{ name: "Sage", swatch: "#ccc", availability: "in_stock", images: ["a.webp"] }],
    ...over,
  };
}

describe("snapshot", () => {
  test("the sales list survives encode and decode, and a malformed list is a miss", async () => {
    const db = createTestD1();
    addSale(db);
    const full = await readPublishedCatalog(db, T0);
    expect(full.sales.length).toBe(1);
    const summary = toSummary(full, "g");
    expect(decodeSummary(encodeSummary(summary)).sales).toEqual(full.sales);
    const broken = JSON.parse(encodeSummary(summary));
    broken.sales = [{ id: "x" }];
    expect(() => decodeSummary(JSON.stringify(broken))).toThrow();
    const old = JSON.parse(encodeSummary(summary));
    old.v = 2;
    expect(() => decodeSummary(JSON.stringify(old))).toThrow();
  });

  test("only active sales that have not ended are in the list", async () => {
    const db = createTestD1();
    addSale(db, { name: "live" });
    addSale(db, { name: "upcoming", starts_at: iso(NOW + HOUR), ends_at: iso(NOW + 2 * HOUR) });
    addSale(db, { name: "open", ends_at: null });
    addSale(db, { name: "ended", starts_at: iso(NOW - 3 * HOUR), ends_at: iso(NOW - 2 * HOUR) });
    addSale(db, { name: "off", active: 0 });
    expect((await readLiveSales(db, T0)).length).toBe(3);
  });

  test("a sale starts and ends at its date without a rebuild or a save", async () => {
    const db = createTestD1();
    addSale(db, { type: "amount", value: 50, starts_at: iso(NOW + HOUR), ends_at: iso(NOW + 2 * HOUR) });
    const summary = toSummary(await readPublishedCatalog(db, T0), "g");
    const card = (priced: ReturnType<typeof priceSummary>) => priced.products[0]!;
    const listPrice = summary.products[0]!.price;

    expect(card(priceSummary(summary, NOW)).price).toBe(listPrice); // before the start
    const during = card(priceSummary(summary, NOW + HOUR + 60_000));
    expect(during.price).toBe(listPrice - 50);
    expect(during.regularPrice).toBe(listPrice);
    expect(during.sale).toMatchObject({ listPrice });
    expect(card(priceSummary(summary, NOW + 2 * HOUR)).price).toBe(listPrice); // after the end
    expect(priceSummary(summary, NOW)).toBe(priceSummary(summary, NOW)); // cached for the minute
  });

  test("price sort and price filter use the sale price", () => {
    // Product A costs 1000 and product B 800. A sale takes 300 off A only: A becomes 700, below B.
    const a = detailProduct({ id: 1, price: 1000, sort: 1 });
    const b = detailProduct({ id: 2, price: 800, sort: 2 });
    const sale = rule({ scope: "product", productId: 1, type: "amount", value: 300 });
    const summary = toSummary({ categories: [], zones: [], products: [a, b], sales: [sale] }, "g");
    const priced = priceSummary(summary, NOW);
    expect(listProducts(priced, { sort: "price-asc" }).items.map((product) => product.id)).toEqual([1, 2]);
    expect(listProducts(summary, { sort: "price-asc" }).items.map((product) => product.id)).toEqual([2, 1]);
    expect(listProducts(priced, { max: 750 }).items.map((product) => product.id)).toEqual([1]);
    expect(listProducts(priced, {}).facets.price).toEqual({ min: 700, max: 800 });
  });

  test("a priced detail carries the sale, and an unsold one is returned as it was", () => {
    const detail = detailProduct({ id: 3, price: 500 });
    const summary = toProductSummary(detail);
    const sale = priceProduct(summary, [rule({ type: "amount", value: 10 })], NOW);
    expect(priceDetail(detail, sale)).toMatchObject({ price: 490, sale: { listPrice: 500 } });
    expect(priceDetail(detail, summary)).toBe(detail);
  });
});

describe("refreshSales and the public functions", () => {
  const keys = snapshotKeys("snapshots/catalog-v1.json");
  let store: FakeStore;
  let d1: ReturnType<typeof meteredD1>;
  const sources = (): CatalogSources => ({ imageBase: "", db: () => d1.db, store, keys });

  beforeEach(async () => {
    installFakeCache();
    store = new FakeStore();
    d1 = meteredD1();
    await invalidateCatalogCache("");
  });
  afterEach(() => removeFakeCache());

  test("saving a sale patches the summary's sales list from the discount rows only", async () => {
    await getCatalogSummary(sources());
    expect(decodeSummary(store.objects.get(keys.summary)!.json).sales).toEqual([]);

    const product = pick(d1.db);
    const saved = await saveDiscount(d1.db, owner, {
      id: null,
      revision: "",
      input: discountInputSchema.parse({
        name: "Mug sale",
        scope: "product",
        categoryId: null,
        productId: product.id,
        type: "amount",
        value: 100,
        startsAt: iso(Date.now() - HOUR),
        endsAt: null,
        active: true,
      }),
    });
    expect(saved.ok).toBe(true);

    d1.clear();
    expect(await refreshSales(sources())).toBe(true);
    // One read: the live discount rows. No catalogue read.
    expect(d1.reads()).toBe(1);
    expect(d1.log[0]!.sql).toContain("FROM discounts");
    const stored = decodeSummary(store.objects.get(keys.summary)!.json);
    expect(stored.sales).toMatchObject([{ scope: "product", productId: product.id, value: 100 }]);

    // The public reads now show the sale: card, product page and bag lookup agree.
    const bag = await getProductsByIds(sources(), [product.id]);
    expect(bag.products[0]).toMatchObject({ price: product.price - 100, regularPrice: product.price });
    expect(bag.products[0]!.sale).toBeTruthy();
    const page = await getProductBySlug(sources(), product.slug);
    expect(page.product).toMatchObject({ price: product.price - 100, regularPrice: product.price });
    expect(page.product!.sale).toBeTruthy();
  });

  test("switching the sale off brings the list price back", async () => {
    const product = pick(d1.db);
    const input = (active: boolean) =>
      discountInputSchema.parse({
        name: "Mug sale",
        scope: "all",
        categoryId: null,
        productId: null,
        type: "percent",
        value: 50,
        startsAt: iso(Date.now() - HOUR),
        endsAt: null,
        active,
      });
    const created = await saveDiscount(d1.db, owner, { id: null, revision: "", input: input(true) });
    if (!created.ok) throw new Error(created.error);
    await getCatalogSummary(sources());
    expect((await getProductsByIds(sources(), [product.id])).products[0]!.price).toBeLessThan(product.price);

    await saveDiscount(d1.db, owner, {
      id: created.discount.id,
      revision: created.discount.revision,
      input: input(false),
    });
    await refreshSales(sources());
    const after = (await getProductsByIds(sources(), [product.id])).products[0]!;
    expect(after.price).toBe(product.price);
    expect(after.sale).toBeFalsy();
  });

  test("public reads read no D1 while the sale is on", async () => {
    addSale(d1.db, { ends_at: null, starts_at: iso(Date.now() - HOUR) });
    await getCatalogSummary(sources());
    d1.clear();
    await getProductsByIds(sources(), [1, 2]);
    expect(d1.log.length).toBe(0);
  });
});

describe("query plans (EXPLAIN QUERY PLAN on the real migrations)", () => {
  const db = createTestD1();
  const explain = (sql: string, params: unknown[] = []) =>
    (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
      (row) => row.detail,
    );

  test("the live sales query probes idx_discounts_live and builds no temp B-tree", () => {
    const details = explain(LIVE_SALES_SQL, [iso(NOW)]);
    if (process.env.SHOW_PLANS) console.log(details.join("\n"));
    expect(details.join("\n")).toContain("idx_discounts_live");
    expect(details.some((detail) => /^SCAN discounts|TEMP B-TREE/.test(detail))).toBe(false);
  });

  test("the admin list reads idx_discounts_admin in order", () => {
    const details = explain(LIST_DISCOUNTS_SQL);
    if (process.env.SHOW_PLANS) console.log(details.join("\n"));
    expect(details.join("\n")).toContain("idx_discounts_admin");
    expect(details.some((detail) => /^SCAN d\b|TEMP B-TREE/.test(detail) && !/USING/.test(detail))).toBe(false);
    expect(details.some((detail) => /TEMP B-TREE/.test(detail))).toBe(false);
  });

  test("the order's sale lookup returns rows through the same index", () => {
    expect(explain(LIVE_SALES_SQL, [iso(NOW)]).some((detail) => /idx_discounts_live/.test(detail))).toBe(true);
  });
});

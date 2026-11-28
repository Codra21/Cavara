import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import type { CheckoutRequest, UpdateOrderInput } from "@/domain/orders";
import { type ProductFormValues, productInputSchema } from "@/domain/product-admin";
import { adjustStockSchema } from "@/domain/stock";
import {
  type CatalogSources,
  getCachedCatalog,
  getCatalogSummary,
  invalidateCatalogCache,
  refreshProducts,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import { getProductBySlug } from "@/server/catalog-queries.server";
import { saveProduct } from "@/server/db/admin-catalog.repository";
import { updateOrderStatus } from "@/server/db/admin-orders.repository";
import { adjustStock } from "@/server/db/stock.repository";
import { submitOrder } from "@/server/services/orders.service";
import { FakeStore, installFakeCache, meteredD1, removeFakeCache } from "./helpers/catalog-doubles";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const keys = snapshotKeys("snapshots/catalog-v1.json");
const T0 = new Date("2026-11-15T04:00:00.000Z");
const IMG = "product-images/test/a.webp";

let store: FakeStore;
let d1: ReturnType<typeof meteredD1>;

const sources = (): CatalogSources => ({ imageBase: "", db: () => d1.db, store, keys });

beforeEach(async () => {
  installFakeCache();
  store = new FakeStore();
  d1 = meteredD1();
  await invalidateCatalogCache("");
});

afterEach(() => {
  removeFakeCache();
});

async function makeCountedProduct(stock: number) {
  const slug = `cancel-reopen-mug-${Math.random().toString(36).slice(2, 8)}`;
  const values: ProductFormValues = {
    name: "Cancel Reopen Mug",
    slug,
    categoryId: "drinkware",
    summary: "Counted stock regression product.",
    details: [],
    note: "",
    price: 500,
    regularPrice: null,
    costPrice: 300,
    status: "published",
    featured: false,
    sort: 999,
    variants: [{ id: null, name: "Sage", swatch: "#9CCB91", availability: "in_stock", images: [IMG] }],
  };
  const saved = await saveProduct(d1.db, {
    actor: owner,
    id: null,
    revision: "",
    input: productInputSchema.parse(values),
  });
  if (!saved.ok) throw new Error(saved.error);
  const variant = d1.db.sqlite
    .query("SELECT id FROM product_variants WHERE product_id = ? ORDER BY position LIMIT 1")
    .get(saved.id) as { id: number };
  const started = await adjustStock(
    d1.db,
    owner,
    adjustStockSchema.parse({ productId: saved.id, variantId: variant.id, action: "start", quantity: stock, note: "" }),
    T0,
  );
  if (!started.ok) throw new Error(started.error);
  return { id: saved.id, slug, variantId: variant.id };
}

function checkout(productId: number, qty: number): CheckoutRequest {
  return {
    idempotencyKey: crypto.randomUUID(),
    name: "Test Customer",
    phone: "01712345678",
    zoneId: "inside-dhaka",
    address: "House 1, Road 2, Dhanmondi, Dhaka",
    note: "",
    deliveryCharge: 80 + 20 * Math.max(0, qty - 1),
    items: [{ productId, variant: 0, qty, unitPrice: 500 }],
    website: "",
  };
}

const change = (id: string, version: number, status: UpdateOrderInput["status"]): UpdateOrderInput => ({
  id,
  version,
  status,
  paymentStatus: "unpaid",
  note: "",
});

describe("C3: cancel/reopen refreshes R2 snapshots when counted stock changes without crossing 0", () => {
  test("cancelling (2 -> 4) and reopening (4 -> 2) return the product id and refresh R2 snapshots", async () => {
    const product = await makeCountedProduct(4);
    const placed = await submitOrder(d1.db, checkout(product.id, 2), {
      client: "test",
      limitSecret: "x".repeat(40),
      now: T0,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error("expected order placement to succeed");

    const orderRow = d1.db.sqlite.query("SELECT id FROM orders WHERE reference = ?").get(placed.reference) as {
      id: string;
    };

    // Prime all three R2 snapshots (catalog-v4.json, catalog-v1.json, products/v2/<id>.json) at stock = 2.
    const summaryBefore = await getCatalogSummary(sources());
    await getCachedCatalog(sources());
    const detailBefore = await getProductBySlug(sources(), product.slug);
    expect(summaryBefore.products.find((p) => p.id === product.id)?.variants[0]?.stock).toBe(2);
    expect(detailBefore.product?.variants[0]?.stock).toBe(2);

    // Cancel order: counted stock moves 2 -> 4 (never touches 0).
    store.resetCounts();
    const cancelled = await updateOrderStatus(d1.db, owner, change(orderRow.id, 1, "cancelled"), T0);
    expect(cancelled).toMatchObject({ ok: true, version: 2, movedProducts: [product.id] });
    if (cancelled.ok && cancelled.movedProducts?.length) {
      expect(await refreshProducts(sources(), cancelled.movedProducts)).toBe(true);
    }

    expect(store.writes).toEqual([keys.detail(product.id), keys.summary, keys.legacy]);
    expect((await getCatalogSummary(sources())).products.find((p) => p.id === product.id)?.variants[0]?.stock).toBe(4);
    expect((await getProductBySlug(sources(), product.slug)).product?.variants[0]?.stock).toBe(4);

    // Reopen order: counted stock moves 4 -> 2 (never touches 0).
    store.resetCounts();
    const reopened = await updateOrderStatus(d1.db, owner, change(orderRow.id, 2, "new"), T0);
    expect(reopened).toMatchObject({ ok: true, version: 3, movedProducts: [product.id] });
    if (reopened.ok && reopened.movedProducts?.length) {
      expect(await refreshProducts(sources(), reopened.movedProducts)).toBe(true);
    }

    expect(store.writes).toEqual([keys.detail(product.id), keys.summary, keys.legacy]);
    expect((await getCatalogSummary(sources())).products.find((p) => p.id === product.id)?.variants[0]?.stock).toBe(2);
    expect((await getProductBySlug(sources(), product.slug)).product?.variants[0]?.stock).toBe(2);
  });
});

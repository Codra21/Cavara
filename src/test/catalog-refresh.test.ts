import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  decodeSummary,
  encodeSummary,
  patchSummaryProduct,
  toProductSummary,
  toSummary,
} from "@/domain/catalog-snapshot";
import { type ProductFormValues, productInputSchema, productToForm } from "@/domain/product-admin";
import {
  type CatalogSources,
  getCachedCatalog,
  getCatalogSummary,
  invalidateCatalogCache,
  refreshProduct,
  refreshZones,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import { getProductBySlug, getProductsByIds } from "@/server/catalog-queries.server";
import { getAdminProduct, saveProduct } from "@/server/db/admin-catalog.repository";
import { saveZones } from "@/server/db/admin-orders.repository";
import {
  ALL_PRODUCTS_SQL,
  ALL_VARIANTS_SQL,
  CATEGORIES_SQL,
  getPublishedCatalog,
  ONE_PRODUCT_SQL,
  ONE_VARIANTS_SQL,
  readPublishedCatalog,
  readSnapshotProduct,
  ZONES_SQL,
} from "@/server/db/catalog.repository";
import {
  addSyntheticProducts,
  FakeCache,
  FakeStore,
  installFakeCache,
  meteredD1,
  removeFakeCache,
} from "./helpers/catalog-doubles";
import type { TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const keys = snapshotKeys("snapshots/catalog-v1.json");
const COST = 7391;
const RED_POLKA = 2;

let edge: FakeCache;
let store: FakeStore;
let d1: ReturnType<typeof meteredD1>;

const sources = (): CatalogSources => ({ imageBase: "", db: () => d1.db, store, keys });

beforeEach(async () => {
  edge = installFakeCache();
  store = new FakeStore();
  d1 = meteredD1();
  await invalidateCatalogCache("");
});

afterEach(() => {
  removeFakeCache();
});

/** Fills every cache layer, as a shop with some traffic would. */
async function prime(db = d1) {
  const source = { ...sources(), db: () => db.db };
  await getCachedCatalog(source);
  await getCatalogSummary(source);
}

async function edit(id: number, change: (form: ProductFormValues) => Partial<ProductFormValues>, db: TestD1 = d1.db) {
  const loaded = (await getAdminProduct(db, id))!;
  const form = productToForm(loaded);
  const result = await saveProduct(db, {
    actor: owner,
    id,
    revision: loaded.revision,
    input: productInputSchema.parse({ ...form, ...change(form) }),
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function createProduct(values: Partial<ProductFormValues>) {
  const result = await saveProduct(d1.db, {
    actor: owner,
    id: null,
    revision: "",
    input: productInputSchema.parse({
      name: "New Mug",
      slug: "new-mug",
      categoryId: "drinkware",
      summary: "A mug.",
      details: ["350 ml"],
      note: "",
      price: 1200,
      regularPrice: null,
      costPrice: COST,
      status: "published",
      featured: false,
      sort: 999,
      variants: [
        { id: null, name: "Sage", swatch: "#9CCB91", availability: "in_stock", images: ["product-images/test/a.webp"] },
      ],
      ...values,
    }),
  });
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

/** What a full rebuild from D1 would store now, for comparing with what the patches produced. */
async function rebuiltSummary() {
  return toSummary(await readPublishedCatalog(d1.db), "x");
}
const withoutGen = <T extends { gen: string }>(value: T) => ({ ...value, gen: "x" });

describe("a product save patches only that product", () => {
  test("rewrites its detail and its entries; everything else stays byte for byte", async () => {
    await prime();
    const summaryBefore = await getCatalogSummary(sources());
    const legacyBefore = await getCachedCatalog(sources());
    await edit(RED_POLKA, () => ({ name: "Renamed Cup", price: 1700, regularPrice: 2000, costPrice: COST }));
    store.resetCounts();
    d1.clear();

    expect(await refreshProduct(sources(), RED_POLKA)).toBe(true);

    // Three R2 writes: its detail, the summary, the legacy catalogue. Never another product's detail.
    expect(store.writes).toEqual([keys.detail(RED_POLKA), keys.summary, keys.legacy]);
    // D1: its own rows only (two statements, a few rows).
    expect(d1.reads()).toBe(2);
    expect(d1.rowsReturned()).toBeLessThan(15);

    const summary = await getCatalogSummary(sources());
    expect(summary.gen).toBe(summaryBefore.gen);
    expect(summary.products.length).toBe(summaryBefore.products.length);
    for (const product of summary.products) {
      if (product.id === RED_POLKA) continue;
      expect(product).toEqual(summaryBefore.products.find((p) => p.id === product.id)!);
    }
    expect(summary.products.find((p) => p.id === RED_POLKA)).toMatchObject({
      name: "Renamed Cup",
      price: 1700,
      regularPrice: 2000,
    });
    // The patched objects equal what a full rebuild would produce.
    expect(withoutGen(summary)).toEqual(await rebuiltSummary());
    const legacy = await getCachedCatalog(sources());
    expect(legacy).toEqual(await getPublishedCatalog(d1.db));
    expect(
      legacy.products.filter((p) => p.name === legacyBefore.products.find((q) => q.id === p.id)!.name).length,
    ).toBe(legacyBefore.products.length - 1);
    expect((await getProductBySlug(sources(), "red-polka-bow-cup-bread-plate")).product?.name).toBe("Renamed Cup");
  });

  test("publishing, reordering, unpublishing and archiving keep the order a full rebuild would give", async () => {
    await prime();
    const fresh = await createProduct({ status: "draft", sort: 0 });
    expect(await refreshProduct(sources(), fresh)).toBe(true);
    // A draft is not public.
    expect((await getCatalogSummary(sources())).products.some((p) => p.id === fresh)).toBe(false);

    await edit(fresh, () => ({ status: "published", sort: 0 }));
    await refreshProduct(sources(), fresh);
    let summary = await getCatalogSummary(sources());
    expect(summary.products.findIndex((p) => p.id === fresh)).toBe(
      (await rebuiltSummary()).products.findIndex((p) => p.id === fresh),
    );
    expect(store.objects.has(keys.detail(fresh))).toBe(true);

    await edit(fresh, () => ({ sort: 12 }));
    await refreshProduct(sources(), fresh);
    await edit(3, () => ({ status: "archived" }));
    await refreshProduct(sources(), 3);
    await edit(5, () => ({ status: "draft" }));
    await refreshProduct(sources(), 5);

    summary = await getCatalogSummary(sources());
    expect(withoutGen(summary)).toEqual(await rebuiltSummary());
    expect(await getCachedCatalog(sources())).toEqual(await getPublishedCatalog(d1.db));
    expect(summary.products.some((p) => p.id === 3 || p.id === 5)).toBe(false);
  });

  test("archiving removes the product from every public shape", async () => {
    await prime();
    await getProductBySlug(sources(), "red-polka-bow-cup-bread-plate"); // writes its detail object
    expect(store.objects.has(keys.detail(RED_POLKA))).toBe(true);

    await edit(RED_POLKA, () => ({ status: "archived" }));
    await refreshProduct(sources(), RED_POLKA);

    expect((await getCatalogSummary(sources())).products.some((p) => p.id === RED_POLKA)).toBe(false);
    expect((await getCachedCatalog(sources())).products.some((p) => p.id === RED_POLKA)).toBe(false);
    expect(store.objects.has(keys.detail(RED_POLKA))).toBe(false);
    expect((await getProductBySlug(sources(), "red-polka-bow-cup-bread-plate")).product).toBeNull();
    const byIds = await getProductsByIds(sources(), [RED_POLKA, 3]);
    expect(byIds.missing).toEqual([RED_POLKA]);
    expect(byIds.products.map((p) => p.id)).toEqual([3]);
    // Even from another data center that has none of the cached copies.
    await invalidateCatalogCache("");
    edge.entries.clear();
    expect((await getProductBySlug(sources(), "red-polka-bow-cup-bread-plate")).product).toBeNull();
  });

  test("changing the slug moves the product to the new address and frees the old one", async () => {
    await prime();
    await edit(RED_POLKA, () => ({ slug: "polka-cup-set" }));
    await refreshProduct(sources(), RED_POLKA);
    expect((await getProductBySlug(sources(), "red-polka-bow-cup-bread-plate")).product).toBeNull();
    expect((await getProductBySlug(sources(), "polka-cup-set")).product?.id).toBe(RED_POLKA);
    expect(withoutGen(await getCatalogSummary(sources()))).toEqual(await rebuiltSummary());
  });

  test("with no snapshots yet there is nothing to patch; the next read rebuilds with the change", async () => {
    await edit(RED_POLKA, () => ({ name: "Before any snapshot" }));
    expect(await refreshProduct(sources(), RED_POLKA)).toBe(true);
    expect(store.writes).toEqual([]);
    expect((await getCatalogSummary(sources())).products.find((p) => p.id === RED_POLKA)?.name).toBe(
      "Before any snapshot",
    );
  });

  test("without a snapshot store (local dev) it only drops the cached copies", async () => {
    await prime();
    const local: CatalogSources = { imageBase: "", db: () => d1.db };
    await edit(RED_POLKA, () => ({ name: "Local" }));
    d1.clear();
    expect(await refreshProduct(local, RED_POLKA)).toBe(true);
    expect(d1.log.length).toBe(0);
    expect((await getCatalogSummary(local)).products.find((p) => p.id === RED_POLKA)?.name).toBe("Local");
  });
});

describe("rows read per save", () => {
  async function measure(extraProducts: number) {
    const metered = meteredD1();
    if (extraProducts) addSyntheticProducts(metered.db, extraProducts);
    const source: CatalogSources = { imageBase: "", db: () => metered.db, store: new FakeStore(), keys };
    await invalidateCatalogCache("");
    await getCachedCatalog(source);
    await getCatalogSummary(source);
    await edit(RED_POLKA, () => ({ name: `Edited with ${extraProducts} extra` }), metered.db);
    metered.clear();
    (source.store as FakeStore).resetCounts();
    expect(await refreshProduct(source, RED_POLKA)).toBe(true);
    return {
      statements: metered.log.map((entry) => entry.sql),
      rows: metered.rowsReturned(),
      writes: (source.store as FakeStore).writes,
    };
  }

  test("do not grow with the catalogue: 24 products and 524 products cost the same", async () => {
    const small = await measure(0);
    const large = await measure(500);
    expect(large.statements).toEqual(small.statements);
    expect(large.rows).toBe(small.rows);
    expect(large.writes).toEqual(small.writes);
    // 1 product row + 2 colours with their pictures (6 join rows); a handful, not hundreds.
    expect(small.rows).toBeLessThan(15);
  });

  test("a zones save reads only the zones", async () => {
    await prime();
    expect(
      (
        await saveZones(d1.db, owner, [
          { id: "inside-dhaka", name: "Inside Dhaka", charge: 95, active: true },
          { id: "outside-dhaka", name: "Outside Dhaka", charge: 150, active: false },
        ])
      ).ok,
    ).toBe(true);
    d1.clear();
    store.resetCounts();
    expect(await refreshZones(sources())).toBe(true);
    expect(d1.reads()).toBe(1);
    expect(d1.rowsReturned()).toBe(1); // only the one active zone is read
    expect(store.writes).toEqual([keys.summary, keys.legacy]);
    const summary = await getCatalogSummary(sources());
    expect(summary.zones).toEqual([{ id: "inside-dhaka", name: "Inside Dhaka", charge: 95 }]);
    expect((await getCachedCatalog(sources())).deliveryZones).toEqual(summary.zones);
    expect(summary.products.length).toBe(24);
  });
});

describe("query plans (EXPLAIN QUERY PLAN on the real migrations)", () => {
  const plan = (sql: string, params: unknown[] = []) =>
    (d1.db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
      (row) => row.detail,
    );

  test("the one-product reads search by primary key and the UNIQUE indexes", () => {
    expect(plan(ONE_PRODUCT_SQL, [2])).toEqual(["SEARCH p USING INTEGER PRIMARY KEY (rowid=?)"]);
    expect(plan(ONE_VARIANTS_SQL, [2])).toEqual([
      "SEARCH v USING INDEX sqlite_autoindex_product_variants_1 (product_id=?)",
      "SEARCH i USING INDEX sqlite_autoindex_product_images_1 (variant_id=?) LEFT-JOIN",
    ]);
  });

  test("the full rebuild reads start at idx_products_status_sort and never scan products, colours or pictures", () => {
    expect(plan(ALL_PRODUCTS_SQL)).toEqual(["SEARCH p USING INDEX idx_products_status_sort (status=?)"]);
    // Any covering index that starts with status will do (migration 0009 added several; SQLite picks the smallest).
    const variantPlan = plan(ALL_VARIANTS_SQL);
    expect(variantPlan[0]).toMatch(/^SEARCH p USING COVERING INDEX idx_products_status_\w+ \(status=\?\)$/);
    expect(variantPlan.slice(1)).toEqual([
      "SEARCH v USING INDEX sqlite_autoindex_product_variants_1 (product_id=?)",
      "SEARCH i USING INDEX sqlite_autoindex_product_images_1 (variant_id=?) LEFT-JOIN",
    ]);
  });

  test("categories and zones are the only scans, of 4 and 2 rows, and need no temp B-tree", () => {
    expect(plan(CATEGORIES_SQL)).toEqual(["SCAN categories"]);
    expect(plan(ZONES_SQL)).toEqual(["SCAN delivery_zones"]);
  });
});

describe("what the public can see", () => {
  test("cost_price is in no stored object, edge copy or function result", async () => {
    await prime();
    const id = await createProduct({ costPrice: COST, price: 1200 });
    await refreshProduct(sources(), id);
    await getProductBySlug(sources(), "new-mug");
    await getProductsByIds(sources(), [id]);
    const everything = [
      ...[...store.objects.values()].map((object) => object.json),
      ...edge.entries.values(),
      JSON.stringify(await getProductBySlug(sources(), "new-mug")),
      JSON.stringify(await getProductsByIds(sources(), [id, RED_POLKA])),
      JSON.stringify(await getCatalogSummary(sources())),
      JSON.stringify(await getCachedCatalog(sources())),
    ].join("\n");
    expect(everything).toContain("New Mug"); // the product is in there, so the search is meaningful
    expect(everything).not.toContain(String(COST));
    expect(everything).not.toMatch(/cost_?price/i);
    expect(everything).not.toMatch(/"archived_at"|"revision"/);
  });

  test("the stored summary stays well under the size of the full catalogue", async () => {
    await prime();
    const summary = store.objects.get(keys.summary)!.json.length;
    const legacy = store.objects.get(keys.legacy)!.json.length;
    expect(summary).toBeLessThan(legacy / 2);
  });
});

describe("concurrent and failing saves", () => {
  test("a save that loses the etag race re-reads and patches again, so both changes land", async () => {
    await prime();
    await edit(RED_POLKA, () => ({ name: "Saved first" }));
    await edit(3, () => ({ name: "Saved second" }));
    // Another save (of product 3) lands between this save's read of the summary and its write.
    const other = toProductSummary((await readSnapshotProduct(d1.db, 3))!);
    store.afterRead = (key) => {
      if (key !== keys.summary) return;
      store.afterRead = undefined;
      const current = decodeSummary(store.objects.get(keys.summary)!.json);
      store.seed(keys.summary, encodeSummary(patchSummaryProduct(current, 3, other)));
    };
    expect(await refreshProduct(sources(), RED_POLKA)).toBe(true);
    const summary = await getCatalogSummary(sources());
    expect(summary.products.find((p) => p.id === RED_POLKA)?.name).toBe("Saved first");
    expect(summary.products.find((p) => p.id === 3)?.name).toBe("Saved second");
  });

  test("after three lost races it falls back to a full rebuild, which matches D1", async () => {
    await prime();
    const before = await getCatalogSummary(sources());
    await edit(RED_POLKA, () => ({ name: "Rebuilt by fallback" }));
    // Every read is followed by someone else's write, so the conditional write can never succeed.
    store.afterRead = (key) => store.seed(key, store.objects.get(key)?.json ?? "");
    expect(await refreshProduct(sources(), RED_POLKA)).toBe(true);
    store.afterRead = undefined;
    await invalidateCatalogCache("");
    edge.entries.clear();
    const after = await getCatalogSummary(sources());
    expect(after.gen).not.toBe(before.gen);
    expect(withoutGen(after)).toEqual(await rebuiltSummary());
    expect(after.products.find((p) => p.id === RED_POLKA)?.name).toBe("Rebuilt by fallback");
  });

  test("when R2 fails everywhere it deletes the objects and reports it, so the next read rebuilds from D1", async () => {
    await prime();
    await edit(RED_POLKA, () => ({ name: "Not in R2" }));
    store.failWrites = true;
    expect(await refreshProduct(sources(), RED_POLKA)).toBe(false);
    store.failWrites = false;
    expect(store.objects.has(keys.summary)).toBe(false);
    expect(store.objects.has(keys.legacy)).toBe(false);
    await invalidateCatalogCache("");
    edge.entries.clear();
    expect((await getCatalogSummary(sources())).products.find((p) => p.id === RED_POLKA)?.name).toBe("Not in R2");
  });

  test("an unreadable summary is deleted, not patched", async () => {
    await prime();
    store.seed(keys.summary, "{not json");
    await edit(RED_POLKA, () => ({ name: "After corruption" }));
    expect(await refreshProduct(sources(), RED_POLKA)).toBe(true);
    expect(store.objects.has(keys.summary)).toBe(false);
    expect(store.objects.has(keys.legacy)).toBe(false);
    expect((await getCatalogSummary(sources())).products.find((p) => p.id === RED_POLKA)?.name).toBe(
      "After corruption",
    );
  });
});

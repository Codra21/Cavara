import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { decodeSummary, encodeSummary, newGeneration } from "@/domain/catalog-snapshot";
import {
  type CatalogSources,
  getCachedCatalog,
  getCatalogSummary,
  getProductDetail,
  invalidateCatalogCache,
  rebuildCatalog,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import { getProductBySlug, getProductsByIds, getRelatedProducts } from "@/server/catalog-queries.server";
import { FakeCache, FakeStore, installFakeCache, meteredD1, removeFakeCache } from "./helpers/catalog-doubles";

const keys = snapshotKeys("snapshots/catalog-v1.json");
let edge: FakeCache;
let store: FakeStore;
let d1: ReturnType<typeof meteredD1>;

function sources(options: { imageBase?: string; snapshots?: boolean } = {}): CatalogSources {
  const base: CatalogSources = { imageBase: options.imageBase ?? "", db: () => d1.db };
  return options.snapshots === false ? base : { ...base, store, keys };
}

/** A fresh isolate in another data center: no memory, no edge copy. */
async function freshDataCenter() {
  await invalidateCatalogCache("");
  edge.entries.clear();
}

beforeEach(async () => {
  edge = installFakeCache();
  store = new FakeStore();
  d1 = meteredD1();
  await invalidateCatalogCache("");
});

afterEach(() => {
  removeFakeCache();
});

describe("snapshot keys", () => {
  test("the v2 objects sit next to the legacy one", () => {
    expect(keys.summary).toBe("snapshots/catalog-v2.json");
    expect(keys.detail(7)).toBe("snapshots/products/v2/7.json");
    expect(snapshotKeys("catalog-v1.json").summary).toBe("catalog-v2.json");
  });
});

describe("getCatalogSummary", () => {
  test("the first read goes to D1 and writes both objects and the edge copy; the next comes from memory", async () => {
    const first = await getCatalogSummary(sources());
    expect(first.products.length).toBe(24);
    expect(d1.reads()).toBe(4); // one batch: categories, products, variants, zones
    expect(store.objects.has(keys.summary)).toBe(true);
    expect(store.objects.has(keys.legacy)).toBe(true);
    expect(edge.entries.size).toBe(2);
    d1.clear();
    expect(await getCatalogSummary(sources())).toBe(first);
    expect(d1.log.length).toBe(0);
  });

  test("another isolate in the same data center reads the edge copy, not R2 or D1", async () => {
    await getCatalogSummary(sources());
    await invalidateCatalogCache("");
    edge.entries.set(
      new URL("/__cache/catalog/v2", "https://cavarabd.com").toString(),
      store.objects.get(keys.summary)!.json,
    );
    store.resetCounts();
    d1.clear();
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
    expect(store.reads).toEqual([]);
    expect(d1.log.length).toBe(0);
  });

  test("another data center reads the R2 snapshot, not D1", async () => {
    await getCatalogSummary(sources());
    await freshDataCenter();
    d1.clear();
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
    expect(d1.log.length).toBe(0);
    expect(edge.entries.size).toBe(1);
  });

  test("D1 failing does not matter while the snapshot exists", async () => {
    await getCatalogSummary(sources());
    await freshDataCenter();
    const broken: CatalogSources = {
      ...sources(),
      db: () => {
        throw new Error("D1 blocked");
      },
    };
    expect((await getCatalogSummary(broken)).products.length).toBe(24);
  });

  test("an unreadable or other-version snapshot falls back to D1 and is rewritten", async () => {
    store.failReads = true;
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
    store.failReads = false;
    await freshDataCenter();
    store.seed(keys.summary, JSON.stringify({ v: 1, gen: "x", categories: [], zones: [], products: [] }));
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
    expect(decodeSummary(store.objects.get(keys.summary)!.json).products.length).toBe(24);
  });

  test("a failed snapshot write still serves the D1 catalogue", async () => {
    store.failWrites = true;
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
  });

  test("a failed D1 load with no snapshot throws and caches nothing", async () => {
    const broken: CatalogSources = {
      ...sources(),
      db: () => {
        throw new Error("D1 down");
      },
    };
    await expect(getCatalogSummary(broken)).rejects.toThrow("D1 down");
    expect(edge.entries.size).toBe(0);
    expect(store.objects.size).toBe(0);
    expect((await getCatalogSummary(sources())).products.length).toBe(24);
  });

  test("works without a Cache API or a snapshot (local dev)", async () => {
    removeFakeCache();
    await invalidateCatalogCache("");
    expect((await getCatalogSummary(sources({ snapshots: false }))).products.length).toBe(24);
  });

  test("the stored summary round-trips and is compact", async () => {
    const summary = await getCatalogSummary(sources());
    const json = store.objects.get(keys.summary)!.json;
    expect(decodeSummary(json)).toEqual(summary);
    expect(encodeSummary(summary)).toBe(json);
    const perProduct = json.length / summary.products.length;
    expect(perProduct).toBeLessThan(450); // measured: ~350 B/product with the long seed image keys
  });
});

describe("getCachedCatalog (legacy v1)", () => {
  test("a miss rebuilds both objects from one D1 read; the next read needs no D1", async () => {
    const catalog = await getCachedCatalog(sources());
    expect(catalog.products.length).toBe(24);
    expect(d1.reads()).toBe(4);
    expect(store.objects.has(keys.summary)).toBe(true);
    await freshDataCenter();
    d1.clear();
    expect(await getCachedCatalog(sources())).toEqual(catalog);
    expect(d1.log.length).toBe(0);
  });

  test("a snapshot built for another image origin is ignored and rebuilt", async () => {
    await getCachedCatalog(sources({ imageBase: "https://old.example" }));
    await freshDataCenter();
    const catalog = await getCachedCatalog(sources({ imageBase: "https://images.cavarabd.com" }));
    expect(catalog.imageBase).toBe("https://images.cavarabd.com");
    expect(catalog.products[0]?.variants[0].images[0]).toStartWith("https://images.cavarabd.com/");
  });
});

describe("getProductDetail and the public lookups", () => {
  test("a detail miss reads that one product from D1 and stores it; the next read needs no D1", async () => {
    const summary = await getCatalogSummary(sources());
    d1.clear();
    const detail = await getProductDetail(sources(), summary, 2);
    expect(detail?.slug).toBe("red-polka-bow-cup-bread-plate");
    expect(d1.reads()).toBe(2); // the product row and its colours/pictures
    expect(d1.rowsReturned()).toBeLessThan(15);
    expect(store.objects.has(keys.detail(2))).toBe(true);
    await freshDataCenter();
    d1.clear();
    expect((await getProductDetail(sources(), summary, 2))?.name).toBe(detail!.name);
    expect(d1.log.length).toBe(0);
  });

  test("a detail from before the last full rebuild is stale; a newer one is fine", async () => {
    const summary = await getCatalogSummary(sources());
    const detail = await getProductDetail(sources(), summary, 2);
    const doc = (gen: string, name: string) => JSON.stringify({ v: 2, gen, product: { ...detail, name } });
    store.seed(keys.detail(2), doc("2000-01-01T00:00:00.000Z-aaaaaaaa", "stale"));
    await freshDataCenter();
    expect((await getProductDetail(sources(), summary, 2))?.name).toBe(detail!.name);
    expect(JSON.parse(store.objects.get(keys.detail(2))!.json).gen).toBe(summary.gen);

    store.seed(keys.detail(2), doc(newGeneration(new Date(Date.now() + 60_000)), "from a newer rebuild"));
    await freshDataCenter();
    expect((await getProductDetail(sources(), summary, 2))?.name).toBe("from a newer rebuild");
  });

  test("a full rebuild makes every stored detail stale", async () => {
    const summary = await getCatalogSummary(sources());
    await getProductDetail(sources(), summary, 2);
    expect(await rebuildCatalog(sources())).toBe(true);
    await freshDataCenter();
    const rebuilt = await getCatalogSummary(sources());
    expect(rebuilt.gen).not.toBe(summary.gen);
    d1.clear();
    await getProductDetail(sources(), rebuilt, 2);
    expect(d1.reads()).toBe(2);
  });

  test("getProductBySlug: unknown and unpublished slugs read no D1; a known one returns detail and category", async () => {
    await getCatalogSummary(sources());
    d1.clear();
    expect((await getProductBySlug(sources(), "nope")).product).toBeNull();
    expect(d1.log.length).toBe(0);
    const page = await getProductBySlug(
      sources({ imageBase: "https://images.cavarabd.com" }),
      "red-polka-bow-cup-bread-plate",
    );
    expect(page.product?.variants[0].images[0]).toStartWith("https://images.cavarabd.com/");
    expect(page.category?.id).toBe("drinkware");
    expect(page.category?.image).toStartWith("https://images.cavarabd.com/");
    expect(page.product).not.toHaveProperty("sort");
  });

  test("getProductsByIds: order kept, duplicates dropped, unknown ids reported, bounded", async () => {
    await getCatalogSummary(sources());
    d1.clear();
    const result = await getProductsByIds(sources(), [5, 2, 5, 99999, 3]);
    expect(result.products.map((p) => p.id)).toEqual([5, 2, 3]);
    expect(result.missing).toEqual([99999]);
    expect(result.products[0]).not.toHaveProperty("sort");
    expect(d1.log.length).toBe(0);
    const many = await getProductsByIds(
      sources(),
      Array.from({ length: 500 }, (_, i) => i + 1),
    );
    expect(many.products.length + many.missing.length).toBeLessThanOrEqual(50);
  });

  test("getProductsByIds also returns the delivery areas and the category names of the cards", async () => {
    await getCatalogSummary(sources());
    d1.clear();
    const result = await getProductsByIds(sources(), [2]);
    expect(result.zones.map((zone) => zone.charge)).toEqual([80, 150]);
    expect(Object.keys(result.categoryNames)).toEqual([result.products[0]!.category]);
    expect(Object.values(result.categoryNames)[0]).toBeTruthy();
    expect(d1.log.length).toBe(0);
    expect((await getProductsByIds(sources(), [99999])).categoryNames).toEqual({});
  });

  test("getRelatedProducts: four cards from the summary, none for an unknown slug, no D1 read", async () => {
    await getCatalogSummary(sources());
    d1.clear();
    const related = await getRelatedProducts(
      sources({ imageBase: "https://images.cavarabd.com" }),
      "red-polka-bow-cup-bread-plate",
    );
    expect(related.products).toHaveLength(4);
    expect(related.products.map((p) => p.slug)).not.toContain("red-polka-bow-cup-bread-plate");
    expect(related.products[0]!.category).toBe("drinkware");
    expect(related.products[0]!.images[0]).toStartWith("https://images.cavarabd.com/");
    expect(related.products[0]).not.toHaveProperty("sort");
    for (const card of related.products) expect(related.categoryNames[card.category]).toBeTruthy();
    expect((await getRelatedProducts(sources(), "nope")).products).toEqual([]);
    expect(d1.log.length).toBe(0);
  });
});

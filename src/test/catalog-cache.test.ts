import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Catalog } from "@/lib/types";
import { getCachedCatalog, invalidateCatalogCache } from "@/server/catalog-cache.server";

// A Map-backed stand-in for caches.default. Bun has no Cache API.
class FakeCache {
  entries = new Map<string, string>();
  async match(key: string) {
    const body = this.entries.get(key);
    return body === undefined ? undefined : new Response(body);
  }
  async put(key: string, response: Response) {
    this.entries.set(key, await response.text());
  }
  async delete(key: string) {
    return this.entries.delete(key);
  }
}

const catalog = (name: string): Catalog => ({ categories: [], products: [], imageBase: name });
const scope = globalThis as { caches?: unknown };
let edge: FakeCache;

beforeEach(async () => {
  edge = new FakeCache();
  scope.caches = { default: edge };
  await invalidateCatalogCache("");
});

afterEach(() => {
  delete scope.caches;
});

describe("getCachedCatalog", () => {
  test("loads from D1 once, then serves from memory", async () => {
    let loads = 0;
    const load = async () => (loads++, catalog("a"));
    expect(await getCachedCatalog("", load)).toEqual(catalog("a"));
    expect(await getCachedCatalog("", load)).toEqual(catalog("a"));
    expect(loads).toBe(1);
    expect(edge.entries.size).toBe(1);
  });

  test("another isolate reads the edge copy instead of D1", async () => {
    await getCachedCatalog("", async () => catalog("a"));
    // Simulate a fresh isolate: memory gone, data center cache still there.
    const copy = new Map(edge.entries);
    await invalidateCatalogCache("");
    edge.entries = copy;
    let loads = 0;
    expect(await getCachedCatalog("", async () => (loads++, catalog("b")))).toEqual(catalog("a"));
    expect(loads).toBe(0);
  });

  test("invalidate forces the next read to D1", async () => {
    await getCachedCatalog("", async () => catalog("a"));
    await invalidateCatalogCache("");
    expect(edge.entries.size).toBe(0);
    expect(await getCachedCatalog("", async () => catalog("b"))).toEqual(catalog("b"));
  });

  test("a failed load is not cached", async () => {
    await expect(getCachedCatalog("", () => Promise.reject(new Error("D1 down")))).rejects.toThrow("D1 down");
    expect(edge.entries.size).toBe(0);
    expect(await getCachedCatalog("", async () => catalog("a"))).toEqual(catalog("a"));
  });

  test("works without a Cache API (bun, tests)", async () => {
    delete scope.caches;
    await invalidateCatalogCache("");
    expect(await getCachedCatalog("", async () => catalog("a"))).toEqual(catalog("a"));
  });
});

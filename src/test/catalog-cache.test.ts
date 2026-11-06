import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Catalog } from "@/lib/types";
import {
  type CatalogSources,
  getCachedCatalog,
  invalidateCatalogCache,
  refreshCatalog,
  type SnapshotStore,
} from "@/server/catalog-cache.server";

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

class FakeSnapshot implements SnapshotStore {
  json: string | null = null;
  failReads = false;
  failWrites = false;
  async read() {
    if (this.failReads) throw new Error("R2 down");
    return this.json;
  }
  async write(json: string) {
    if (this.failWrites) throw new Error("R2 down");
    this.json = json;
  }
  async remove() {
    this.json = null;
  }
}

const catalog = (name: string, imageBase = ""): Catalog => ({
  categories: [],
  products: [{ id: 1, slug: name, name, category: "c", price: 1, summary: "", variants: [] as never }],
  imageBase,
});
const scope = globalThis as { caches?: unknown };
let edge: FakeCache;
let snapshot: FakeSnapshot;
let loads: number;

function sources(load: () => Promise<Catalog>, withSnapshot = true): CatalogSources {
  const wrapped = async () => {
    loads++;
    return load();
  };
  return withSnapshot ? { imageBase: "", loadFromDb: wrapped, snapshot } : { imageBase: "", loadFromDb: wrapped };
}

/** A fresh isolate in another data center: no memory, no edge copy. */
async function freshDataCenter() {
  await invalidateCatalogCache("");
  edge.entries.clear();
}

beforeEach(async () => {
  edge = new FakeCache();
  snapshot = new FakeSnapshot();
  loads = 0;
  scope.caches = { default: edge };
  await invalidateCatalogCache("");
});

afterEach(() => {
  delete scope.caches;
});

describe("getCachedCatalog", () => {
  test("first read goes to D1 and writes the snapshot and edge copy; the next comes from memory", async () => {
    const source = sources(async () => catalog("a"));
    expect(await getCachedCatalog(source)).toEqual(catalog("a"));
    expect(await getCachedCatalog(source)).toEqual(catalog("a"));
    expect(loads).toBe(1);
    expect(snapshot.json).toBe(JSON.stringify(catalog("a")));
    expect(edge.entries.size).toBe(1);
  });

  test("another isolate in the same data center reads the edge copy", async () => {
    await getCachedCatalog(sources(async () => catalog("a")));
    const copy = new Map(edge.entries);
    await invalidateCatalogCache("");
    edge.entries = copy;
    snapshot.json = null;
    expect(await getCachedCatalog(sources(async () => catalog("b")))).toEqual(catalog("a"));
    expect(loads).toBe(1);
  });

  test("another data center reads the R2 snapshot, not D1", async () => {
    snapshot.json = JSON.stringify(catalog("snap"));
    expect(await getCachedCatalog(sources(async () => catalog("db")))).toEqual(catalog("snap"));
    expect(loads).toBe(0);
  });

  test("D1 failing does not matter while the snapshot exists", async () => {
    snapshot.json = JSON.stringify(catalog("snap"));
    const result = await getCachedCatalog(sources(() => Promise.reject(new Error("D1 blocked"))));
    expect(result).toEqual(catalog("snap"));
  });

  test("an unreadable snapshot falls back to D1", async () => {
    snapshot.failReads = true;
    expect(await getCachedCatalog(sources(async () => catalog("db")))).toEqual(catalog("db"));
    expect(loads).toBe(1);
  });

  test("a snapshot built for another image origin is ignored and rebuilt", async () => {
    snapshot.json = JSON.stringify(catalog("old", "https://old.example"));
    expect(await getCachedCatalog(sources(async () => catalog("db")))).toEqual(catalog("db"));
    expect(snapshot.json).toBe(JSON.stringify(catalog("db")));
  });

  test("a failed snapshot write still serves the D1 catalogue", async () => {
    snapshot.failWrites = true;
    expect(await getCachedCatalog(sources(async () => catalog("db")))).toEqual(catalog("db"));
  });

  test("a failed D1 load with no snapshot throws and caches nothing", async () => {
    await expect(getCachedCatalog(sources(() => Promise.reject(new Error("D1 down"))))).rejects.toThrow("D1 down");
    expect(edge.entries.size).toBe(0);
    expect(snapshot.json).toBeNull();
    expect(await getCachedCatalog(sources(async () => catalog("a")))).toEqual(catalog("a"));
  });

  test("works without a Cache API or a snapshot (local dev)", async () => {
    delete scope.caches;
    await invalidateCatalogCache("");
    expect(await getCachedCatalog(sources(async () => catalog("a"), false))).toEqual(catalog("a"));
  });
});

describe("refreshCatalog", () => {
  test("rewrites the snapshot and drops memory and the edge copy", async () => {
    await getCachedCatalog(sources(async () => catalog("a")));
    expect(await refreshCatalog(sources(async () => catalog("b")))).toBe(true);
    expect(snapshot.json).toBe(JSON.stringify(catalog("b")));
    expect(edge.entries.size).toBe(0);
    expect(await getCachedCatalog(sources(async () => catalog("c")))).toEqual(catalog("b"));
  });

  test("when the rebuild fails it deletes the snapshot so the next read goes to D1", async () => {
    snapshot.json = JSON.stringify(catalog("a"));
    expect(await refreshCatalog(sources(() => Promise.reject(new Error("D1 down"))))).toBe(false);
    expect(snapshot.json).toBeNull();
    await freshDataCenter();
    expect(await getCachedCatalog(sources(async () => catalog("b")))).toEqual(catalog("b"));
  });
});

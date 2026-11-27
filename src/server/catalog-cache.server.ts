// Keeps public catalogue reads off D1 and updates the cached copies in place. Server-only; takes its sources as
// arguments so tests can run it on bun.
//
// Three documents (shapes in src/domain/catalog-snapshot.ts):
//   summary  every published product, compact, plus categories and delivery zones   snapshots/catalog-v2.json
//   detail   one product with its text and every picture                             snapshots/products/v2/<id>.json
//   legacy   the full v1 Catalog that getCatalogFn still serves                       snapshots/catalog-v1.json
//
// Read order, for each document:
// 1. This isolate's memory, 30 s. Only resolved values are kept: Workers refuse to share a pending I/O promise
//    between requests.
// 2. The data center's Cache API (caches.default), 5 min. delete() purges only the data center the request ran in
//    (developers.cloudflare.com/workers/runtime-apis/cache/), so other data centers can lag a save by up to 5 min.
// 3. The R2 object. With it, a D1 outage or a blocked Free plan read limit no longer takes the shop down. R2 bills
//    overage instead of blocking.
// 4. D1, only when the object is missing, stale or unreadable. A summary or legacy miss reads the whole catalogue once
//    and rewrites both objects (a "full rebuild"); a detail miss reads that one product.
//
// Writes (refreshProduct, refreshZones) never rebuild when the objects exist. They read the changed product's rows
// (or the zones) from D1 and patch the objects. A full rebuild stays as the fallback and for migrations.
//
// Races, stated plainly:
// - Two saves of different products patch the same summary object. The write is conditional on the object's etag
//   (R2 `onlyIf.etagMatches`); the loser re-reads and patches again, so neither patch is lost. After three lost rounds
//   the save falls back to a full rebuild.
// - Two saves of the same product, or a save racing a rebuild that a cache miss started (a detail, or the whole
//   catalogue), can leave the older state in R2:
//   each reads D1 and then writes, and the later write wins. D1 is always right. R2 is corrected by the next save of
//   that product, the next full rebuild, or by deleting snapshots/catalog-v2.json (the generation check below makes
//   every detail object older than the rebuild stale). Admin saves come from one Owner, so this is rare, and
//   checkout re-reads prices from D1 (invariant 3).
//
// Before caching, every page view ran the catalogue queries (~534 D1 rows read) and one day of traffic used up the
// Free plan's 5M rows read per day (2026-11-06).
import {
  type CatalogSummary,
  decodeDetail,
  decodeSummary,
  detailIsCurrent,
  encodeDetail,
  encodeSummary,
  newGeneration,
  patchLegacyProduct,
  patchLegacyZones,
  patchSummaryProduct,
  patchSummarySales,
  patchSummaryZones,
  predecessorId,
  type ProductDetail,
  type ProductDetailDoc,
  toLegacyCatalog,
  toLegacyProduct,
  toProductSummary,
  toSummary,
} from "@/domain/catalog-snapshot";
import { SITE_URL } from "@/lib/config";
import type { Catalog } from "@/lib/types";
import type { D1Database } from "@/server/db/d1";
import {
  readActiveZones,
  readLiveSales,
  readPublishedCatalog,
  readSnapshotProduct,
  readSnapshotProducts,
} from "@/server/db/catalog.repository";

export const EDGE_TTL_SECONDS = 300;
export const MEMORY_TTL_MS = 30_000;
const MEMORY_DETAIL_LIMIT = 64;
const PATCH_ATTEMPTS = 3;

// Never fetched: cache.match() does not go to the origin. The paths only name the entries. Bump v1/v2 when the
// matching stored shape changes so old entries are ignored (and change the object keys in snapshotKeys, the migration
// scripts and wrangler.jsonc with them).
const EDGE_LEGACY_PATH = "/__cache/catalog/v1";
const EDGE_SUMMARY_PATH = "/__cache/catalog/v3";
const edgeDetailPath = (id: number) => `/__cache/catalog/v2/product/${id}`;

/** Object names inside the IMAGES bucket. */
export interface SnapshotKeys {
  legacy: string;
  summary: string;
  detail: (id: number) => string;
}

/**
 * From the CATALOG_SNAPSHOT_KEY var (the legacy object's key): the summary and detail objects live in the same folder.
 * The summary is `catalog-v3.json` since P9.2 added the sales list; the details stayed `products/v2/` because their
 * shape did not change. Change `catalog-v3.json` together with SUMMARY_VERSION, EDGE_SUMMARY_PATH, SNAPSHOT_OBJECTS in
 * scripts/db/migrate-prod.ts and the package.json db:migrate scripts.
 */
export function snapshotKeys(legacyKey: string): SnapshotKeys {
  const dir = legacyKey.slice(0, legacyKey.lastIndexOf("/") + 1);
  return { legacy: legacyKey, summary: `${dir}catalog-v3.json`, detail: (id) => `${dir}products/v2/${id}.json` };
}

export interface StoredObject {
  json: string;
  etag: string;
}

/** Named JSON objects in R2. `null` from read() means there is none. */
export interface ObjectStore {
  read(key: string): Promise<StoredObject | null>;
  /** With `ifMatch`, writes only if the object still has that etag. Returns false (and writes nothing) when it changed. */
  write(key: string, json: string, ifMatch?: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

export interface CatalogSources {
  imageBase: string;
  /** Lazy, so a snapshot hit never needs the binding. */
  db: () => D1Database;
  /** Absent when snapshots are off (local dev with a local D1). */
  store?: ObjectStore;
  keys?: SnapshotKeys;
}

type WorkerCacheStorage = CacheStorage & { default?: Cache };

interface Timed<T> {
  expires: number;
  value: T;
}

let summaryMemory: Timed<CatalogSummary> | undefined;
let legacyMemory: (Timed<Catalog> & { key: string }) | undefined;
const detailMemory = new Map<number, Timed<ProductDetailDoc>>();

const fresh = <T>(entry: Timed<T> | undefined): entry is Timed<T> => entry !== undefined && entry.expires > Date.now();
const remember = <T>(value: T): Timed<T> => ({ expires: Date.now() + MEMORY_TTL_MS, value });

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: WorkerCacheStorage }).caches?.default;
}

const edgeUrl = (path: string, imageBase?: string) => {
  const url = new URL(path, SITE_URL);
  if (imageBase !== undefined) url.searchParams.set("base", imageBase);
  return url.toString();
};

/** A reader returns the value, or throws for an unreadable document; `accept` rejects a readable but outdated one. */
interface Reader<T> {
  decode: (json: string) => T;
  accept?: (value: T) => boolean;
}

async function readEdge<T>(cache: Cache, key: string, reader: Reader<T>): Promise<T | undefined> {
  try {
    const hit = await cache.match(key);
    if (!hit) return undefined;
    const value = reader.decode(await hit.text());
    return reader.accept && !reader.accept(value) ? undefined : value;
  } catch (error) {
    console.warn("catalogue edge cache read failed", error);
    return undefined;
  }
}

async function writeEdge(cache: Cache, key: string, json: string): Promise<void> {
  const response = new Response(json, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
  });
  try {
    await cache.put(key, response);
  } catch (error) {
    console.warn("catalogue edge cache write failed", error);
  }
}

async function deleteEdge(cache: Cache, key: string): Promise<void> {
  try {
    await cache.delete(key);
  } catch (error) {
    console.warn("catalogue edge cache purge failed", error);
  }
}

async function readObject<T>(
  store: ObjectStore,
  key: string,
  reader: Reader<T>,
): Promise<{ value: T; json: string } | undefined> {
  try {
    const stored = await store.read(key);
    if (!stored) return undefined;
    const value = reader.decode(stored.json);
    return reader.accept && !reader.accept(value) ? undefined : { value, json: stored.json };
  } catch (error) {
    console.warn(`catalogue snapshot ${key} unreadable; reading D1`, error);
    return undefined;
  }
}

// Full rebuild

interface Rebuilt {
  summary: CatalogSummary;
  legacy: Catalog;
  summaryJson: string;
  legacyJson: string;
}

/** One read of the whole published catalogue gives all three documents. A new generation makes old details stale. */
async function readEverything(sources: CatalogSources): Promise<Rebuilt> {
  const full = await readPublishedCatalog(sources.db());
  const summary = toSummary(full, newGeneration());
  const legacy = toLegacyCatalog(full, sources.imageBase);
  return { summary, legacy, summaryJson: encodeSummary(summary), legacyJson: JSON.stringify(legacy) };
}

async function writeRebuilt(sources: CatalogSources, rebuilt: Rebuilt): Promise<void> {
  const { store, keys } = sources;
  if (!store || !keys) return;
  await store.write(keys.summary, rebuilt.summaryJson);
  await store.write(keys.legacy, rebuilt.legacyJson);
}

/** A miss: rebuild from D1, write the objects (a failed write only costs a later rebuild) and the edge copies. */
async function rebuildOnMiss(sources: CatalogSources, cache: Cache | undefined): Promise<Rebuilt> {
  const rebuilt = await readEverything(sources);
  await writeRebuilt(sources, rebuilt).catch((error: unknown) => {
    console.warn("catalogue snapshot write failed", error);
  });
  if (cache) {
    await writeEdge(cache, edgeUrl(EDGE_SUMMARY_PATH), rebuilt.summaryJson);
    await writeEdge(cache, edgeUrl(EDGE_LEGACY_PATH, sources.imageBase), rebuilt.legacyJson);
  }
  return rebuilt;
}

// Reads

/** The summary: every published product, compact. Throws only when D1 is reached and fails (invariant 5). */
export async function getCatalogSummary(sources: CatalogSources): Promise<CatalogSummary> {
  if (fresh(summaryMemory)) return summaryMemory.value;

  const cache = edgeCache();
  const key = edgeUrl(EDGE_SUMMARY_PATH);
  const reader: Reader<CatalogSummary> = { decode: decodeSummary };
  let summary = cache ? await readEdge(cache, key, reader) : undefined;
  if (!summary) {
    const stored =
      sources.store && sources.keys ? await readObject(sources.store, sources.keys.summary, reader) : undefined;
    if (stored) {
      summary = stored.value;
      if (cache) await writeEdge(cache, key, stored.json);
    } else {
      // The summary is gone: the legacy catalogue went with it (migrations delete both), so rebuild both from one read.
      summary = (await rebuildOnMiss(sources, cache)).summary;
    }
  }
  summaryMemory = remember(summary);
  return summary;
}

/** The legacy full catalogue (resolved URLs). A snapshot built for another image origin is a miss. */
export async function getCachedCatalog(sources: CatalogSources): Promise<Catalog> {
  const key = edgeUrl(EDGE_LEGACY_PATH, sources.imageBase);
  if (fresh(legacyMemory) && legacyMemory.key === key) return legacyMemory.value;

  const cache = edgeCache();
  const reader: Reader<Catalog> = { decode: (json) => parseLegacy(json, sources.imageBase) };
  let catalog = cache ? await readEdge(cache, key, reader) : undefined;
  if (!catalog) {
    const stored =
      sources.store && sources.keys ? await readObject(sources.store, sources.keys.legacy, reader) : undefined;
    if (stored) {
      catalog = stored.value;
      if (cache) await writeEdge(cache, key, stored.json);
    } else {
      catalog = (await rebuildOnMiss(sources, cache)).legacy;
    }
  }
  legacyMemory = { ...remember(catalog), key };
  return catalog;
}

function parseLegacy(json: string, imageBase: string): Catalog {
  const value = JSON.parse(json) as Partial<Catalog>;
  // Written before delivery zones joined the catalogue (unit 7), or built for another image origin: a miss.
  if (
    !Array.isArray(value.products) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.deliveryZones) ||
    value.imageBase !== imageBase
  )
    throw new Error("legacy catalogue snapshot is outdated");
  return value as Catalog;
}

/**
 * One product's detail, or undefined when D1 no longer shows it as public. `summary` is the one the caller found the
 * product in: a stored detail older than its generation is stale and is rebuilt from D1.
 */
export async function getProductDetail(
  sources: CatalogSources,
  summary: CatalogSummary,
  id: number,
): Promise<ProductDetail | undefined> {
  const memory = detailMemory.get(id);
  if (fresh(memory) && detailIsCurrent(memory.value.gen, summary.gen)) return memory.value.product;

  const reader: Reader<ProductDetailDoc> = {
    decode: decodeDetail,
    accept: (doc) => doc.product.id === id && detailIsCurrent(doc.gen, summary.gen),
  };
  const cache = edgeCache();
  const key = edgeUrl(edgeDetailPath(id));
  let doc = cache ? await readEdge(cache, key, reader) : undefined;
  if (!doc) {
    const objectKey = sources.keys?.detail(id);
    const stored = sources.store && objectKey ? await readObject(sources.store, objectKey, reader) : undefined;
    if (stored) {
      doc = stored.value;
      if (cache) await writeEdge(cache, key, stored.json);
    } else {
      const product = await readSnapshotProduct(sources.db(), id);
      if (!product) return undefined;
      doc = { gen: summary.gen, product };
      const json = encodeDetail(doc);
      if (sources.store && objectKey)
        await sources.store.write(objectKey, json).catch((error: unknown) => {
          console.warn("product snapshot write failed", error);
        });
      if (cache) await writeEdge(cache, key, json);
    }
  }
  if (detailMemory.size >= MEMORY_DETAIL_LIMIT) detailMemory.delete(detailMemory.keys().next().value as number);
  detailMemory.set(id, remember(doc));
  return doc.product;
}

// Invalidation and writes

/** Clears this isolate's copies and this data center's edge copies of the summary and legacy documents. */
export async function invalidateCatalogCache(imageBase: string, productIds: number[] = []): Promise<void> {
  summaryMemory = undefined;
  legacyMemory = undefined;
  if (productIds.length) for (const id of productIds) detailMemory.delete(id);
  else detailMemory.clear();
  const cache = edgeCache();
  if (!cache) return;
  await deleteEdge(cache, edgeUrl(EDGE_SUMMARY_PATH));
  await deleteEdge(cache, edgeUrl(EDGE_LEGACY_PATH, imageBase));
  // Cache API calls share the Free plan's 50-per-request quota, and a bulk action can name 50 products. Purge at most
  // MAX_DETAIL_PURGES detail copies; any others in this data center expire within the 5-minute edge TTL, the same lag
  // other data centers already have.
  for (const id of productIds.slice(0, MAX_DETAIL_PURGES)) await deleteEdge(cache, edgeUrl(edgeDetailPath(id)));
}

/** Detail edge copies purged per invalidation; leaves room under the 50 Cache API calls per request on Free. */
export const MAX_DETAIL_PURGES = 40;

type PatchResult<T> =
  | { status: "patched"; value: T }
  /** No object: the next read rebuilds from D1, which already has the change. */
  | { status: "absent" }
  /** Unreadable or inconsistent: delete it so the next read rebuilds. */
  | { status: "unusable" }
  /** Lost the etag race on every attempt. */
  | { status: "conflict" };

/** Read, patch, conditionally write; retried when another save changed the object in between. */
async function patchObject<T>(
  store: ObjectStore,
  key: string,
  options: {
    decode: (json: string) => T;
    encode: (value: T) => string;
    /** undefined = the object cannot be patched (it disagrees with the change). */
    patch: (value: T) => T | undefined;
    /** An object the caller just read, used for the first attempt. */
    first?: StoredObject | null;
  },
): Promise<PatchResult<T>> {
  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
    const stored = attempt === 0 && options.first !== undefined ? options.first : await store.read(key);
    if (!stored) return { status: "absent" };
    let next: T | undefined;
    try {
      next = options.patch(options.decode(stored.json));
    } catch (error) {
      console.warn(`catalogue snapshot ${key} unreadable`, error);
      return { status: "unusable" };
    }
    if (next === undefined) return { status: "unusable" };
    if (await store.write(key, options.encode(next), stored.etag)) return { status: "patched", value: next };
  }
  return { status: "conflict" };
}

/**
 * After a product save: patch the summary, that product's detail and the legacy catalogue from that product's D1 rows,
 * then drop this data center's cached copies. Returns false only when the objects could not be brought up to date;
 * they are then deleted (best effort) so the next read rebuilds from D1, and the caller shows a warning.
 */
export async function refreshProduct(sources: CatalogSources, productId: number): Promise<boolean> {
  const { store, keys } = sources;
  if (!store || !keys) {
    await invalidateCatalogCache(sources.imageBase, [productId]);
    return true;
  }
  try {
    const product = await readSnapshotProduct(sources.db(), productId);
    const summaryObject = await store.read(keys.summary);
    if (summaryObject) {
      let gen: string | undefined;
      try {
        gen = decodeSummary(summaryObject.json).gen;
      } catch {
        // patchObject below reports it as unusable.
      }
      // The detail goes first, so a summary never points at a detail older than itself.
      if (gen !== undefined) {
        if (product) await store.write(keys.detail(productId), encodeDetail({ gen, product }));
        else await store.remove(keys.detail(productId));
      }
      const summaryPatch = await patchObject(store, keys.summary, {
        decode: decodeSummary,
        encode: encodeSummary,
        patch: (summary) => patchSummaryProduct(summary, productId, product ? toProductSummary(product) : null),
        first: summaryObject,
      });
      if (summaryPatch.status === "conflict") return await rebuildCatalog(sources);
      if (summaryPatch.status === "unusable") {
        await store.remove(keys.summary);
        await store.remove(keys.legacy);
      } else if (summaryPatch.status === "patched") {
        const afterId = predecessorId(summaryPatch.value, productId);
        const legacyPatch = await patchObject(store, keys.legacy, {
          decode: (json) => parseLegacy(json, sources.imageBase),
          encode: (catalog) => JSON.stringify(catalog),
          patch: (catalog) =>
            patchLegacyProduct(
              catalog,
              productId,
              product ? toLegacyProduct(product, sources.imageBase) : null,
              afterId,
            ),
        });
        if (legacyPatch.status === "conflict") return await rebuildCatalog(sources);
        if (legacyPatch.status === "unusable") await store.remove(keys.legacy);
      }
    } else {
      await Promise.all([store.remove(keys.legacy), store.remove(keys.detail(productId))]);
    }
  } catch (error) {
    console.error("catalogue snapshot patch failed; rebuilding", error);
    return rebuildCatalog(sources);
  }
  await invalidateCatalogCache(sources.imageBase, [productId]);
  return true;
}

/** R2 writes run a few at a time: enough to be quick, few enough to stay inside the Worker's open-connection limit. */
const DETAIL_WRITE_BATCH = 8;

/**
 * Like refreshProduct for several products at once (a bulk action): one multi-product read, one patch of the summary
 * and of the legacy catalogue, one detail write or delete per product. Rows read follow the products listed, not the
 * catalogue. The same rules apply: no objects means nothing to patch, an unreadable object is deleted, three lost etag
 * races fall back to the full rebuild, and false means the objects could not be brought up to date.
 */
export async function refreshProducts(sources: CatalogSources, productIds: number[]): Promise<boolean> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return true;
  const { store, keys } = sources;
  if (!store || !keys) {
    await invalidateCatalogCache(sources.imageBase, ids);
    return true;
  }
  try {
    const products = new Map((await readSnapshotProducts(sources.db(), ids)).map((product) => [product.id, product]));
    const summaryObject = await store.read(keys.summary);
    if (summaryObject) {
      let gen: string | undefined;
      try {
        gen = decodeSummary(summaryObject.json).gen;
      } catch {
        // patchObject below reports it as unusable.
      }
      // The details go first, so a summary never points at a detail older than itself.
      if (gen !== undefined) {
        for (let start = 0; start < ids.length; start += DETAIL_WRITE_BATCH) {
          await Promise.all(
            ids.slice(start, start + DETAIL_WRITE_BATCH).map((id) => {
              const product = products.get(id);
              return product
                ? store.write(keys.detail(id), encodeDetail({ gen: gen as string, product }))
                : store.remove(keys.detail(id));
            }),
          );
        }
      }
      const summaryPatch = await patchObject(store, keys.summary, {
        decode: decodeSummary,
        encode: encodeSummary,
        patch: (summary) =>
          ids.reduce((current, id) => {
            const product = products.get(id);
            return patchSummaryProduct(current, id, product ? toProductSummary(product) : null);
          }, summary),
        first: summaryObject,
      });
      if (summaryPatch.status === "conflict") return await rebuildCatalog(sources);
      if (summaryPatch.status === "unusable") {
        await store.remove(keys.summary);
        await store.remove(keys.legacy);
      } else if (summaryPatch.status === "patched") {
        const patched = summaryPatch.value;
        const legacyPatch = await patchObject(store, keys.legacy, {
          decode: (json) => parseLegacy(json, sources.imageBase),
          encode: (catalog) => JSON.stringify(catalog),
          patch: (catalog) => {
            // Removals first, then insertions in display order, so each product's predecessor is already in place.
            const position = new Map(patched.products.map((product, index) => [product.id, index]));
            const present = ids
              .filter((id) => products.has(id))
              .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
            let current: Catalog | undefined = catalog;
            for (const id of ids)
              if (!products.has(id) && current) current = patchLegacyProduct(current, id, null, null);
            for (const id of present) {
              if (!current) break;
              current = patchLegacyProduct(
                current,
                id,
                toLegacyProduct(products.get(id) as ProductDetail, sources.imageBase),
                predecessorId(patched, id),
              );
            }
            return current;
          },
        });
        if (legacyPatch.status === "conflict") return await rebuildCatalog(sources);
        if (legacyPatch.status === "unusable") await store.remove(keys.legacy);
      }
    } else {
      await store.remove(keys.legacy);
      for (let start = 0; start < ids.length; start += DETAIL_WRITE_BATCH) {
        await Promise.all(ids.slice(start, start + DETAIL_WRITE_BATCH).map((id) => store.remove(keys.detail(id))));
      }
    }
  } catch (error) {
    console.error("catalogue snapshot patch failed; rebuilding", error);
    return rebuildCatalog(sources);
  }
  await invalidateCatalogCache(sources.imageBase, ids);
  return true;
}

/** After a delivery-zone save: the zones are the only part of the snapshots that changes. */
export async function refreshZones(sources: CatalogSources): Promise<boolean> {
  const { store, keys } = sources;
  if (!store || !keys) {
    await invalidateCatalogCache(sources.imageBase);
    return true;
  }
  try {
    const zones = await readActiveZones(sources.db());
    const summaryPatch = await patchObject(store, keys.summary, {
      decode: decodeSummary,
      encode: encodeSummary,
      patch: (summary) => patchSummaryZones(summary, zones),
    });
    const legacyPatch = await patchObject(store, keys.legacy, {
      decode: (json) => parseLegacy(json, sources.imageBase),
      encode: (catalog) => JSON.stringify(catalog),
      patch: (catalog) => patchLegacyZones(catalog, zones),
    });
    if (summaryPatch.status === "conflict" || legacyPatch.status === "conflict") return await rebuildCatalog(sources);
    if (summaryPatch.status === "unusable") await store.remove(keys.summary);
    if (legacyPatch.status === "unusable") await store.remove(keys.legacy);
  } catch (error) {
    console.error("catalogue snapshot patch failed; rebuilding", error);
    return rebuildCatalog(sources);
  }
  await invalidateCatalogCache(sources.imageBase);
  return true;
}

/**
 * After a sale is saved: the sales list is the only part of the summary that changes (the legacy catalogue holds list
 * prices and no sales, so it is left alone). Reads just the live discount rows, patches the summary in place and purges
 * this data center's copies, as refreshZones does. No summary object means the next read rebuilds from D1.
 */
export async function refreshSales(sources: CatalogSources): Promise<boolean> {
  const { store, keys } = sources;
  if (!store || !keys) {
    await invalidateCatalogCache(sources.imageBase);
    return true;
  }
  try {
    const sales = await readLiveSales(sources.db(), new Date());
    const patch = await patchObject(store, keys.summary, {
      decode: decodeSummary,
      encode: encodeSummary,
      patch: (summary) => patchSummarySales(summary, sales),
    });
    if (patch.status === "conflict") return await rebuildCatalog(sources);
    if (patch.status === "unusable") await store.remove(keys.summary);
  } catch (error) {
    console.error("catalogue snapshot patch failed; rebuilding", error);
    return rebuildCatalog(sources);
  }
  await invalidateCatalogCache(sources.imageBase);
  return true;
}

/**
 * The full rebuild: read every published product from D1 and rewrite the summary and legacy objects under a new
 * generation (which also makes every stored detail stale). Returns false when it fails; the objects are then deleted
 * (best effort) so the next read rebuilds from D1 instead of serving the old catalogue until the next save.
 */
export async function rebuildCatalog(sources: CatalogSources): Promise<boolean> {
  let ok = true;
  if (sources.store && sources.keys) {
    try {
      await writeRebuilt(sources, await readEverything(sources));
    } catch (error) {
      ok = false;
      console.error("catalogue snapshot rebuild failed", error);
      for (const key of [sources.keys.summary, sources.keys.legacy])
        await sources.store.remove(key).catch((removeError: unknown) => {
          console.error("catalogue snapshot delete failed", removeError);
        });
    }
  }
  await invalidateCatalogCache(sources.imageBase);
  return ok;
}

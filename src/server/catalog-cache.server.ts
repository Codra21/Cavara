// Keeps public catalogue reads off D1. Server-only; takes its sources as arguments so tests can run it on bun.
//
// Read order:
// 1. This isolate's memory, 30 s. Only resolved values are kept: Workers refuse to share a pending I/O promise
//    between requests.
// 2. The data center's Cache API (caches.default), 5 min. delete() purges only the data center the request ran in
//    (developers.cloudflare.com/workers/runtime-apis/cache/), so other data centers can lag a save by up to 5 min.
// 3. The R2 snapshot (one JSON object), rewritten on every product save. With it, a D1 outage or a blocked Free
//    plan read limit no longer takes the shop down. R2 bills overage instead of blocking.
// 4. D1, which also rewrites the snapshot. Reached only when the snapshot is missing, stale or unreadable.
//
// Before caching, every page view ran the catalogue queries (~534 D1 rows read) and one day of traffic used up the
// Free plan's 5M rows read per day (2026-11-06).
import { SITE_URL } from "@/lib/config";
import type { Catalog } from "@/lib/types";

export const EDGE_TTL_SECONDS = 300;
export const MEMORY_TTL_MS = 30_000;

// Never fetched: cache.match() does not go to the origin. The path only names the entry. Bump v1 when the Catalog
// shape changes so old entries are ignored (and change the snapshot key in wrangler.jsonc with it).
const EDGE_KEY_PATH = "/__cache/catalog/v1";

/** The R2 object holding the catalogue as JSON. `null` from read() means there is none. */
export interface SnapshotStore {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
  remove(): Promise<void>;
}

export interface CatalogSources {
  imageBase: string;
  loadFromDb: () => Promise<Catalog>;
  /** Absent when snapshots are off (local dev with a local D1). */
  snapshot?: SnapshotStore;
}

type WorkerCacheStorage = CacheStorage & { default?: Cache };

let memory: { key: string; expires: number; catalog: Catalog } | undefined;

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: WorkerCacheStorage }).caches?.default;
}

function edgeKey(imageBase: string): string {
  const url = new URL(EDGE_KEY_PATH, SITE_URL);
  url.searchParams.set("base", imageBase);
  return url.toString();
}

/** Parses a stored catalogue. A snapshot built with another image origin holds the wrong URLs, so it is a miss. */
function parseCatalog(json: string, imageBase: string): Catalog | undefined {
  const value = JSON.parse(json) as Partial<Catalog>;
  // A snapshot written before delivery zones joined the catalogue (unit 7) lacks deliveryZones: treat it as a miss
  // so it is rebuilt from D1 once, instead of bumping the cache and snapshot keys.
  if (
    !Array.isArray(value.products) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.deliveryZones) ||
    value.imageBase !== imageBase
  )
    return undefined;
  return value as Catalog;
}

async function readEdge(cache: Cache, key: string, imageBase: string): Promise<Catalog | undefined> {
  try {
    const hit = await cache.match(key);
    return hit ? parseCatalog(await hit.text(), imageBase) : undefined;
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

async function readSnapshot(
  store: SnapshotStore,
  imageBase: string,
): Promise<{ catalog: Catalog; json: string } | undefined> {
  try {
    const json = await store.read();
    const catalog = json === null ? undefined : parseCatalog(json, imageBase);
    return catalog && json !== null ? { catalog, json } : undefined;
  } catch (error) {
    console.warn("catalogue snapshot read failed; reading D1", error);
    return undefined;
  }
}

/** The public catalogue. Throws only when D1 is reached and fails (invariant 5: never an empty catalogue). */
export async function getCachedCatalog(sources: CatalogSources): Promise<Catalog> {
  const key = edgeKey(sources.imageBase);
  if (memory && memory.key === key && memory.expires > Date.now()) return memory.catalog;

  const cache = edgeCache();
  let catalog = cache ? await readEdge(cache, key, sources.imageBase) : undefined;
  if (!catalog) {
    const stored = sources.snapshot ? await readSnapshot(sources.snapshot, sources.imageBase) : undefined;
    let json: string;
    if (stored) {
      ({ catalog, json } = stored);
    } else {
      catalog = await sources.loadFromDb();
      json = JSON.stringify(catalog);
      if (sources.snapshot)
        await sources.snapshot.write(json).catch((error: unknown) => {
          console.warn("catalogue snapshot write failed", error);
        });
    }
    if (cache) await writeEdge(cache, key, json);
  }
  memory = { key, expires: Date.now() + MEMORY_TTL_MS, catalog };
  return catalog;
}

/** Clears this isolate's copy and this data center's edge copy. Others expire within the TTLs above. */
export async function invalidateCatalogCache(imageBase: string): Promise<void> {
  memory = undefined;
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.delete(edgeKey(imageBase));
  } catch (error) {
    console.warn("catalogue edge cache purge failed", error);
  }
}

/**
 * After a catalogue write: rebuild the snapshot from D1, then drop the cached copies. Returns false when the snapshot
 * could not be rewritten; it is then deleted (best effort) so the next read rebuilds it from D1 instead of serving
 * the old catalogue until the next save.
 */
export async function refreshCatalog(sources: CatalogSources): Promise<boolean> {
  let ok = true;
  if (sources.snapshot) {
    try {
      await sources.snapshot.write(JSON.stringify(await sources.loadFromDb()));
    } catch (error) {
      ok = false;
      console.error("catalogue snapshot rebuild failed", error);
      await sources.snapshot.remove().catch((removeError: unknown) => {
        console.error("catalogue snapshot delete failed", removeError);
      });
    }
  }
  await invalidateCatalogCache(sources.imageBase);
  return ok;
}

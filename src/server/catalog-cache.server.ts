// Caches the public catalogue so page views stop reading D1. Server-only.
//
// Two layers:
// 1. This isolate's memory for MEMORY_TTL_MS. Only resolved values are kept: Workers refuse to share a pending
//    I/O promise between requests.
// 2. The Cache API (caches.default) of the data center for EDGE_TTL_SECONDS. It works on the Workers Custom
//    Domains cavarabd.com uses. delete() only purges the data center the request ran in
//    (developers.cloudflare.com/workers/runtime-apis/cache/), so other data centers can serve the old catalogue
//    until their copy expires.
//
// Without caching, every page view and every client refetch ran four catalogue queries (~534 D1 rows read).
import { SITE_URL } from "@/lib/config";
import type { Catalog } from "@/lib/types";

export const EDGE_TTL_SECONDS = 300;
export const MEMORY_TTL_MS = 30_000;

// Never fetched: cache.match() does not go to the origin. The path only names the entry. Bump v1 when the
// Catalog shape changes so old entries are ignored.
const KEY_PATH = "/__cache/catalog/v1";

type WorkerCacheStorage = CacheStorage & { default?: Cache };

let memory: { key: string; expires: number; catalog: Catalog } | undefined;

function edgeCache(): Cache | undefined {
  const storage = (globalThis as { caches?: WorkerCacheStorage }).caches;
  return storage?.default;
}

function cacheKey(imageBase: string): string {
  const url = new URL(KEY_PATH, SITE_URL);
  url.searchParams.set("base", imageBase);
  return url.toString();
}

async function readEdge(cache: Cache, key: string): Promise<Catalog | undefined> {
  try {
    const hit = await cache.match(key);
    return hit ? ((await hit.json()) as Catalog) : undefined;
  } catch (error) {
    console.warn("catalogue cache read failed; reading D1", error);
    return undefined;
  }
}

async function writeEdge(cache: Cache, key: string, catalog: Catalog): Promise<void> {
  const response = new Response(JSON.stringify(catalog), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
  });
  try {
    await cache.put(key, response);
  } catch (error) {
    console.warn("catalogue cache write failed", error);
  }
}

/** The catalogue from memory, then the edge cache, then `load()` (D1). Errors from `load()` are never cached. */
export async function getCachedCatalog(imageBase: string, load: () => Promise<Catalog>): Promise<Catalog> {
  const key = cacheKey(imageBase);
  if (memory && memory.key === key && memory.expires > Date.now()) return memory.catalog;

  const cache = edgeCache();
  let catalog = cache ? await readEdge(cache, key) : undefined;
  if (!catalog) {
    catalog = await load();
    if (cache) await writeEdge(cache, key, catalog);
  }
  memory = { key, expires: Date.now() + MEMORY_TTL_MS, catalog };
  return catalog;
}

/** Call after a catalogue write. Clears this isolate and this data center; others expire within the TTLs. */
export async function invalidateCatalogCache(imageBase: string): Promise<void> {
  memory = undefined;
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.delete(cacheKey(imageBase));
  } catch (error) {
    console.warn("catalogue cache purge failed", error);
  }
}

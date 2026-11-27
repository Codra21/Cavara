// Caches home banners & section settings like the catalogue (memory -> Cache API -> R2 -> D1). Server-only.
import { DEFAULT_HOME_SETTINGS, type HomeSettings, homeSettingsSchema } from "@/domain/home-settings";
import { SITE_URL } from "@/lib/config";
import { type CatalogSources, EDGE_TTL_SECONDS, MEMORY_TTL_MS } from "@/server/catalog-cache.server";
import { readHomeSettings } from "@/server/db/admin-home.repository";

const EDGE_HOME_PATH = "/__cache/home/v1";

type WorkerCacheStorage = CacheStorage & { default?: Cache };
let homeMemory: { expires: number; value: HomeSettings } | undefined;

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: WorkerCacheStorage }).caches?.default;
}

function homeObjectKey(sources: CatalogSources): string | undefined {
  if (!sources.keys) return undefined;
  const legacy = sources.keys.legacy;
  const dir = legacy.slice(0, legacy.lastIndexOf("/") + 1);
  return `${dir}home-v1.json`;
}

function decodeHome(json: string): HomeSettings {
  return homeSettingsSchema.parse(JSON.parse(json));
}

export async function getCachedHomeSettings(sources: CatalogSources): Promise<HomeSettings> {
  if (homeMemory && homeMemory.expires > Date.now()) return homeMemory.value;

  const cache = edgeCache();
  const edgeKey = new URL(EDGE_HOME_PATH, SITE_URL).toString();
  if (cache) {
    try {
      const hit = await cache.match(edgeKey);
      if (hit) {
        const value = decodeHome(await hit.text());
        homeMemory = { expires: Date.now() + MEMORY_TTL_MS, value };
        return value;
      }
    } catch {
      // fall through
    }
  }

  const key = homeObjectKey(sources);
  if (sources.store && key) {
    try {
      const stored = await sources.store.read(key);
      if (stored) {
        const value = decodeHome(stored.json);
        if (cache) {
          await cache
            .put(
              edgeKey,
              new Response(stored.json, {
                headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
              }),
            )
            .catch(() => {});
        }
        homeMemory = { expires: Date.now() + MEMORY_TTL_MS, value };
        return value;
      }
    } catch {
      // fall through
    }
  }

  let value: HomeSettings = DEFAULT_HOME_SETTINGS;
  try {
    value = await readHomeSettings(sources.db());
  } catch (error) {
    // D1 unavailable, or the table not migrated yet: serve the defaults and keep them for the memory TTL, so a failing
    // D1 is asked at most once per isolate per TTL instead of on every home view (the read budget).
    console.error("home settings read failed:", error);
    homeMemory = { expires: Date.now() + MEMORY_TTL_MS, value: DEFAULT_HOME_SETTINGS };
    return DEFAULT_HOME_SETTINGS;
  }
  const json = JSON.stringify(value);
  if (sources.store && key) await sources.store.write(key, json).catch(() => {});
  if (cache) {
    await cache
      .put(
        edgeKey,
        new Response(json, {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
        }),
      )
      .catch(() => {});
  }
  homeMemory = { expires: Date.now() + MEMORY_TTL_MS, value };
  return value;
}

export async function refreshHomeSettings(sources: CatalogSources, settings: HomeSettings): Promise<boolean> {
  homeMemory = { expires: Date.now() + MEMORY_TTL_MS, value: settings };
  const json = JSON.stringify(settings);
  let ok = true;
  const key = homeObjectKey(sources);
  if (sources.store && key) {
    try {
      await sources.store.write(key, json);
    } catch {
      ok = false;
      await sources.store.remove(key).catch(() => {});
    }
  }
  const cache = edgeCache();
  if (cache) {
    const edgeKey = new URL(EDGE_HOME_PATH, SITE_URL).toString();
    await cache.delete(edgeKey).catch(() => {});
  }
  return ok;
}

export function clearHomeMemoryCache() {
  homeMemory = undefined;
}

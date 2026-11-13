// Wires the catalogue cache to this Worker's D1 and R2 bindings. Server-only.
import type { CatalogSources, ObjectStore } from "@/server/catalog-cache.server";
import { snapshotKeys } from "@/server/catalog-cache.server";
import { getDb, getImageBase, getImages, getSnapshotKey } from "@/server/env";

function r2Store(): ObjectStore {
  return {
    async read(key) {
      const object = await getImages().get(key);
      return object ? { json: await object.text(), etag: object.etag } : null;
    },
    async write(key, json, ifMatch) {
      const httpMetadata = { contentType: "application/json" };
      // put() returns null when the etag condition fails (developers.cloudflare.com/r2/api/workers/workers-api-reference/).
      const written = await getImages().put(
        key,
        json,
        ifMatch === undefined ? { httpMetadata } : { httpMetadata, onlyIf: { etagMatches: ifMatch } },
      );
      return written !== null;
    },
    async remove(key) {
      await getImages().delete(key);
    },
  };
}

export function catalogSources(): CatalogSources {
  const sources: CatalogSources = { imageBase: getImageBase(), db: getDb };
  const key = getSnapshotKey();
  if (key) {
    sources.store = r2Store();
    sources.keys = snapshotKeys(key);
  }
  return sources;
}

// Wires the catalogue cache to this Worker's D1 and R2 bindings. Server-only.
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { getDb, getImageBase, getImages, getSnapshotKey } from "@/server/env";
import type { CatalogSources, SnapshotStore } from "@/server/catalog-cache.server";

function r2Snapshot(key: string): SnapshotStore {
  return {
    async read() {
      const object = await getImages().get(key);
      return object ? object.text() : null;
    },
    async write(json) {
      await getImages().put(key, json, { httpMetadata: { contentType: "application/json" } });
    },
    async remove() {
      await getImages().delete(key);
    },
  };
}

export function catalogSources(): CatalogSources {
  const imageBase = getImageBase();
  const key = getSnapshotKey();
  const sources: CatalogSources = { imageBase, loadFromDb: () => getPublishedCatalog(getDb(), imageBase) };
  if (key) sources.snapshot = r2Snapshot(key);
  return sources;
}

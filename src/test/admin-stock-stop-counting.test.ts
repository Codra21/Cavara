import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { decodeDetail, decodeSummary } from "@/domain/catalog-snapshot";
import {
  type CatalogSources,
  getCachedCatalog,
  getCatalogSummary,
  getProductDetail,
  invalidateCatalogCache,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import type { R2Bucket, R2Object, R2ObjectBody, R2PutOptions } from "@/server/db/d1";
import { FakeStore, installFakeCache, removeFakeCache } from "./helpers/catalog-doubles";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };

mock.module("cloudflare:workers", () => ({
  env: {},
  waitUntil() {},
}));

// Bun keeps module mocks for the rest of the run: keep the real exports here and put them back in afterAll.
const realStart = { ...(await import("@tanstack/react-start")) };
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  createServerFn: () => {
    let validate: ((input: unknown) => unknown) | undefined;
    const builder = {
      middleware: () => builder,
      validator: (schema: ((input: unknown) => unknown) | { parse: (input: unknown) => unknown }) => {
        validate = (input) => (typeof schema === "function" ? schema(input) : schema.parse(input));
        return builder;
      },
      handler: (fn: (ctx: { data: unknown; context: { admin: AdminIdentity } }) => unknown) => {
        return async ({ data }: { data: unknown }) =>
          fn({ data: validate ? validate(data) : data, context: { admin: owner } });
      },
    };
    return builder;
  },
}));
afterAll(() => {
  mock.module("@tanstack/react-start", () => realStart);
});

const { env: workerEnv } = (await import("cloudflare:workers")) as unknown as { env: Record<string, unknown> };
const { adjustStockFn, stopCountingFn } = await import("@/server/functions/admin-stock.functions");

const LEGACY_KEY = "snapshots/catalog-v1.json";
const keys = snapshotKeys(LEGACY_KEY);
const PRODUCT_ID = 2;

function fakeR2Object(key: string, json: string, etag: string): R2Object {
  return {
    key,
    size: json.length,
    etag,
    httpEtag: `"${etag}"`,
    uploaded: new Date(0),
    writeHttpMetadata() {},
  };
}

function fakeR2Bucket(store: FakeStore): R2Bucket {
  return {
    async get(key: string): Promise<R2ObjectBody | null> {
      const stored = await store.read(key);
      if (!stored) return null;
      return {
        ...fakeR2Object(key, stored.json, stored.etag),
        body: new ReadableStream<Uint8Array>(),
        text: async () => stored.json,
      };
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions,
    ): Promise<R2Object | null> {
      const text = typeof value === "string" ? value : "";
      const ifMatch = options?.onlyIf && !(options.onlyIf instanceof Headers) ? options.onlyIf.etagMatches : undefined;
      const written = await store.write(key, text, ifMatch);
      if (!written) return null;
      const stored = store.objects.get(key);
      return fakeR2Object(key, text, stored?.etag ?? "etag");
    },
    async delete(target: string | string[]) {
      const list = Array.isArray(target) ? target : [target];
      for (const key of list) await store.remove(key);
    },
  };
}

let db: TestD1;
let store: FakeStore;

const sources = (): CatalogSources => ({ imageBase: "", db: () => db, store, keys });

function firstVariantId(database: TestD1, productId: number): number {
  const row = database.sqlite
    .query("SELECT id FROM product_variants WHERE product_id = ? ORDER BY position LIMIT 1")
    .get(productId) as { id: number } | null;
  if (!row) throw new Error(`No variant found for product ${productId}`);
  return row.id;
}

beforeEach(async () => {
  installFakeCache();
  db = createTestD1();
  store = new FakeStore();
  workerEnv.DB = db;
  workerEnv.IMAGES = fakeR2Bucket(store);
  workerEnv.CATALOG_SNAPSHOT_KEY = LEGACY_KEY;
  workerEnv.IMAGE_BASE_URL = "";
  await invalidateCatalogCache("");
});

afterEach(() => {
  removeFakeCache();
  delete workerEnv.DB;
  delete workerEnv.IMAGES;
  delete workerEnv.CATALOG_SNAPSHOT_KEY;
  delete workerEnv.IMAGE_BASE_URL;
});

describe("stopCountingFn R2 snapshot refresh (M5)", () => {
  test("refreshes catalog-v4.json, catalog-v1.json, and products/v2/<id>.json and clears the stale stock cap", async () => {
    const variantId = firstVariantId(db, PRODUCT_ID);

    // Prime all three R2 snapshot documents.
    const summaryBefore = await getCatalogSummary(sources());
    await getCachedCatalog(sources());
    await getProductDetail(sources(), summaryBefore, PRODUCT_ID);

    // Start counting with a cap of 2 so the snapshots store stock: 2.
    const started = await adjustStockFn({
      data: { productId: PRODUCT_ID, variantId, action: "start", quantity: 2, note: "Initial count" },
    });
    expect(started).toMatchObject({ ok: true, stock: 2 });

    const summaryCounted = decodeSummary(store.objects.get(keys.summary)!.json);
    const detailCounted = decodeDetail(store.objects.get(keys.detail(PRODUCT_ID))!.json);
    expect(summaryCounted.products.find((p) => p.id === PRODUCT_ID)?.variants[0]?.stock).toBe(2);
    expect(detailCounted.product.variants[0]?.stock).toBe(2);
    const legacyEtagBeforeStop = store.objects.get(keys.legacy)!.etag;

    // Stop counting and verify refreshProduct patches all three R2 snapshots.
    store.resetCounts();
    const stopped = await stopCountingFn({ data: { productId: PRODUCT_ID, variantId } });
    expect(stopped).toEqual({ ok: true });

    expect(store.writes).toEqual([keys.detail(PRODUCT_ID), keys.summary, keys.legacy]);
    expect(store.objects.get(keys.legacy)!.etag).not.toBe(legacyEtagBeforeStop);

    const summaryAfter = decodeSummary(store.objects.get(keys.summary)!.json);
    const detailAfter = decodeDetail(store.objects.get(keys.detail(PRODUCT_ID))!.json);
    expect(summaryAfter.products.find((p) => p.id === PRODUCT_ID)?.variants[0]?.stock).toBeNull();
    expect(detailAfter.product.variants[0]?.stock).toBeNull();
  });

  test("returns a refresh warning when R2 snapshot refresh fails after stopping", async () => {
    const variantId = firstVariantId(db, PRODUCT_ID);
    const summaryBefore = await getCatalogSummary(sources());
    await getCachedCatalog(sources());
    await getProductDetail(sources(), summaryBefore, PRODUCT_ID);

    const started = await adjustStockFn({
      data: { productId: PRODUCT_ID, variantId, action: "start", quantity: 2, note: "Initial count" },
    });
    expect(started).toMatchObject({ ok: true, stock: 2 });

    store.failWrites = true;
    const stopped = await stopCountingFn({ data: { productId: PRODUCT_ID, variantId } });
    expect(stopped).toEqual({
      ok: true,
      warning: "Saved, but the shop's copy of the stock could not be updated. It will catch up within a few minutes.",
    });
  });

  test("does not touch R2 snapshots when stopCounting fails", async () => {
    const variantId = firstVariantId(db, PRODUCT_ID);
    const summaryBefore = await getCatalogSummary(sources());
    await getCachedCatalog(sources());
    await getProductDetail(sources(), summaryBefore, PRODUCT_ID);

    store.resetCounts();
    const stopped = await stopCountingFn({ data: { productId: PRODUCT_ID, variantId } });
    expect(stopped).toMatchObject({ ok: false });
    expect(store.writes).toEqual([]);
  });
});

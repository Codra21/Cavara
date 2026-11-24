// Stand-ins for the bindings the catalogue cache talks to: R2 (with etags, like the real conditional put) and the
// data center's Cache API. Bun has neither.
import type { ObjectStore, StoredObject } from "@/server/catalog-cache.server";
import { createTestD1, type TestD1 } from "./d1";

/** A Map-backed R2 bucket. Every write gets a new etag; a conditional write fails when the etag moved. */
export class FakeStore implements ObjectStore {
  objects = new Map<string, StoredObject>();
  reads: string[] = [];
  writes: string[] = [];
  failReads = false;
  failWrites = false;
  /** Runs after every read while set, to simulate another save landing between a read and its write. */
  afterRead?: (key: string) => void;
  private counter = 0;

  async read(key: string) {
    if (this.failReads) throw new Error("R2 down");
    this.reads.push(key);
    const stored = this.objects.get(key) ?? null;
    const snapshot = stored ? { ...stored } : null;
    this.afterRead?.(key);
    return snapshot;
  }

  async write(key: string, json: string, ifMatch?: string) {
    if (this.failWrites) throw new Error("R2 down");
    if (ifMatch !== undefined && this.objects.get(key)?.etag !== ifMatch) return false;
    this.writes.push(key);
    this.objects.set(key, { json, etag: `etag-${++this.counter}` });
    return true;
  }

  async remove(key: string) {
    this.objects.delete(key);
  }

  /** Test setup: put an object without counting it as a write. */
  seed(key: string, json: string) {
    this.objects.set(key, { json, etag: `etag-${++this.counter}` });
  }

  resetCounts() {
    this.reads = [];
    this.writes = [];
  }
}

/** A Map-backed stand-in for caches.default. */
export class FakeCache {
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

const scope = globalThis as { caches?: unknown };

export function installFakeCache(): FakeCache {
  const cache = new FakeCache();
  scope.caches = { default: cache };
  return cache;
}

export function removeFakeCache() {
  delete scope.caches;
}

export interface StatementLog {
  sql: string;
  rows: number;
}

/** A test D1 that records every statement and the rows it returned, for read-budget assertions. */
export function meteredD1() {
  const log: StatementLog[] = [];
  const db = createTestD1({ observe: (sql, rows) => log.push({ sql, rows }) });
  const isRead = (entry: StatementLog) => /^\s*(select|with)\b/i.test(entry.sql);
  return {
    db,
    log,
    /** Number of read statements run. */
    reads: () => log.filter(isRead).length,
    /** Rows those statements returned (what grew with the catalogue before this change). */
    rowsReturned: () => log.filter(isRead).reduce((sum, entry) => sum + entry.rows, 0),
    clear: () => {
      log.length = 0;
    },
  };
}

/**
 * Adds `count` published products with 3 colours and 5 pictures each (3 on the first colour, 1 on the others) straight to a test database (ids from 1000), to
 * show that a save's cost does not follow the catalogue size. Never run against a shared local D1.
 */
export function addSyntheticProducts(db: TestD1, count: number): void {
  db.sqlite.run(
    `WITH RECURSIVE n(i) AS (SELECT 1000 UNION ALL SELECT i + 1 FROM n WHERE i < ${1000 + count - 1})
     INSERT INTO products (id, slug, name, category_id, summary, details, note, price, regular_price, cost_price, status, featured, sort, created_at)
     SELECT i, 'synthetic-' || i, 'Synthetic product number ' || i, 'drinkware', 'A synthetic product used to size the catalogue.',
       '["Size - 220 ml","Hand painted"]', NULL, 500 + i, NULL, 100, 'published', i % 10 = 0, 100 + i, '2026-11-01T00:00:00.000Z'
     FROM n`,
  );
  db.sqlite.run(
    `INSERT INTO product_variants (product_id, position, name, swatch, availability)
     SELECT p.id, v.pos, 'Colour ' || v.pos, '#aabbcc', 'in_stock'
     FROM products p, (SELECT 0 AS pos UNION SELECT 1 UNION SELECT 2) v WHERE p.id >= 1000`,
  );
  db.sqlite.run(
    `INSERT INTO product_images (variant_id, position, path)
     SELECT v.id, k.pos, 'products/' || v.product_id || '/00000000-0000-4000-8000-' || printf('%012d', v.id * 10 + k.pos) || '.webp'
     FROM product_variants v, (SELECT 0 AS pos UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) k
     WHERE v.product_id >= 1000 AND k.pos < CASE v.position WHEN 0 THEN 3 ELSE 1 END`,
  );
}

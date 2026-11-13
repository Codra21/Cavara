import { describe, expect, test } from "bun:test";
import {
  ADMIN_PRODUCT_SORTS,
  type AdminProductQuery,
  type AdminProductSort,
  decodeCursor,
  encodeCursor,
  firstPage,
  parseAdminProductSearch,
  sliceAdminPage,
  withDefaultSort,
} from "@/domain/admin-product-list";
import type { ProductStatus } from "@/domain/product-admin";
import {
  buildListStatements,
  countAdminProducts,
  countsSql,
  listAdminProducts,
  listProductNames,
  PAGE_COLOURS_SQL,
  PRODUCT_NAMES_SQL,
} from "@/server/db/admin-product-list.repository";
import { createTestD1, type TestD1 } from "./helpers/d1";

// ---------------------------------------------------------------------------------------------------------------
// Test data: a few hundred products with many ties in every sort column, so a page boundary falls inside a tie.

const NAMES = [
  "apple cup",
  "Apple Cup",
  "APPLE CUP",
  "Zeta bowl",
  "zeta Bowl",
  "été mug",
  "Ünder plate",
  "50% off mug",
  "Tea 'n' Toast",
  "Mug",
  "mug",
  "Mug set",
];
const STAMPS = Array.from({ length: 9 }, (_, i) => `2026-11-0${i + 1}T10:00:00.000Z`);
const PRICES = [150, 150, 400, 400, 400, 990, 1200];
const STATUSES: ProductStatus[] = ["draft", "published", "published", "archived"];

interface Seeded {
  id: number;
  name: string;
  price: number;
  updatedAt: string;
  status: ProductStatus;
  category: string;
  outOfStock: boolean;
}

function categoryIds(db: TestD1): string[] {
  return (db.sqlite.query("SELECT id FROM categories ORDER BY sort, id").all() as { id: string }[]).map((r) => r.id);
}

/** Deterministic pseudo-random products (ids from 1000) with colours, some out of stock, some with pictures. */
function seed(db: TestD1, count: number): Seeded[] {
  let state = 12345;
  const next = (n: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % n;
  };
  const categories = categoryIds(db);
  const insertProduct = db.sqlite.query(
    `INSERT INTO products (id, slug, name, category_id, price, cost_price, status, featured, sort, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'r')`,
  );
  const insertVariant = db.sqlite.query(
    "INSERT INTO product_variants (product_id, position, name, swatch, availability) VALUES (?, ?, ?, '#fff', ?)",
  );
  const insertImage = db.sqlite.query(
    "INSERT INTO product_images (variant_id, position, path) VALUES (last_insert_rowid(), 0, ?)",
  );
  const seeded: Seeded[] = [];
  for (let i = 0; i < count; i++) {
    const id = 1000 + i;
    const name = NAMES[next(NAMES.length)]!;
    const price = PRICES[next(PRICES.length)]!;
    const updatedAt = STAMPS[next(STAMPS.length)]!;
    const status = STATUSES[next(STATUSES.length)]!;
    const category = categories[next(categories.length)]!;
    insertProduct.run(id, `seed-${id}`, name, category, price, 100, status, updatedAt, updatedAt);
    let outOfStock = false;
    const colours = next(4);
    for (let position = 0; position < colours; position++) {
      const availability = next(5) === 0 ? "out_of_stock" : "in_stock";
      outOfStock ||= availability === "out_of_stock";
      insertVariant.run(id, position, `Colour ${position}`, availability);
      if (next(3) > 0) insertImage.run(`product-images/seed/${id}-${position}.webp`);
    }
    seeded.push({ id, name, price, updatedAt, status, category, outOfStock });
  }
  return seeded;
}

// What SQLite's NOCASE does: fold ASCII letters only, then compare bytes. Comparing code points matches UTF-8 order.
const fold = (text: string) => [...text.replace(/[A-Z]/g, (c) => c.toLowerCase())].map((c) => c.codePointAt(0)!);
function compareNoCase(a: string, b: string): number {
  const x = fold(a);
  const y = fold(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

function expectedOrder(rows: Seeded[], query: AdminProductQuery): number[] {
  const matching = rows.filter(
    (row) =>
      (!query.status || row.status === query.status) &&
      (!query.category || row.category === query.category) &&
      (!query.outOfStock || row.outOfStock),
  );
  const sorters: Record<AdminProductSort, (a: Seeded, b: Seeded) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id,
    name: (a, b) => compareNoCase(a.name, b.name) || a.id - b.id,
    price_asc: (a, b) => a.price - b.price || a.id - b.id,
    price_desc: (a, b) => b.price - a.price || b.id - a.id,
  };
  return matching.sort(sorters[query.sort]).map((row) => row.id);
}

/** Every combination of filters and sorts the page can ask for. */
function allQueries(): AdminProductQuery[] {
  const queries: AdminProductQuery[] = [];
  for (const sort of ADMIN_PRODUCT_SORTS)
    for (const status of [undefined, ...STATUSES.slice(0, 2), "archived" as const])
      for (const category of [undefined, "drinkware"])
        for (const outOfStock of [undefined, true]) queries.push({ sort, status, category, outOfStock });
  return queries;
}

async function walkForward(db: TestD1, query: AdminProductQuery, pageSize: number) {
  const ids: number[] = [];
  const pages: number[][] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const page = await listAdminProducts(db, { ...query, after }, "", pageSize);
    pages.push(page.products.map((p) => p.id));
    ids.push(...page.products.map((p) => p.id));
    if (!page.next) return { ids, pages, last: page };
    after = page.next;
  }
  throw new Error("paging never ended");
}

describe("keyset paging", () => {
  const db = createTestD1();
  const rows = seed(db, 240);
  // The seeded shop products (ids 1 to 24) are part of the table too.
  const shop = (
    db.sqlite.query("SELECT id, name, price, updated_at, status, category_id FROM products WHERE id < 1000").all() as {
      id: number;
      name: string;
      price: number;
      updated_at: string;
      status: ProductStatus;
      category_id: string;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    price: r.price,
    updatedAt: r.updated_at,
    status: r.status,
    category: r.category_id,
    outOfStock:
      (db.sqlite
        .query("SELECT 1 FROM product_variants WHERE product_id = ? AND availability = 'out_of_stock'")
        .get(r.id) as unknown) !== null,
  }));
  const everything = [...shop, ...rows];

  test("every sort and filter returns each product once, in order, with no gaps (pages of 7)", async () => {
    for (const query of allQueries()) {
      const expected = expectedOrder(everything, query);
      const { ids } = await walkForward(db, query, 7);
      expect(ids, JSON.stringify(query)).toEqual(expected);
    }
  });

  test("paging back from the last page returns the same pages in reverse", async () => {
    for (const query of allQueries()) {
      const forward = await walkForward(db, query, 7);
      const backPages: number[][] = [forward.pages.at(-1) ?? []];
      let before = forward.last.prev ?? undefined;
      for (let guard = 0; before && guard < 500; guard++) {
        const page = await listAdminProducts(db, { ...query, before }, "", 7);
        backPages.unshift(page.products.map((p) => p.id));
        expect(page.next, JSON.stringify(query)).not.toBeNull();
        before = page.prev ?? undefined;
      }
      expect(backPages, JSON.stringify(query)).toEqual(forward.pages);
    }
  });

  test("the first page has no previous page, the last has no next page, and an empty filter has neither", async () => {
    const first = await listAdminProducts(db, { sort: "updated" }, "", 7);
    expect(first.prev).toBeNull();
    expect(first.next).not.toBeNull();
    const last = (await walkForward(db, { sort: "updated" }, 7)).last;
    expect(last.next).toBeNull();
    const none = await listAdminProducts(db, { sort: "name", category: "no-such-category" });
    expect(none).toEqual({ products: [], next: null, prev: null });
  });

  test("a page holds 50 products by default and reports the next one", async () => {
    const page = await listAdminProducts(db, { sort: "price_asc" });
    expect(page.products).toHaveLength(50);
    expect(page.next).not.toBeNull();
    const second = await listAdminProducts(db, { sort: "price_asc", after: page.next ?? undefined });
    const ids = new Set([...page.products, ...second.products].map((p) => p.id));
    expect(ids.size).toBe(100);
  });

  test("names with quotes, percent signs and accents sort like SQLite's NOCASE and page cleanly", async () => {
    const { ids } = await walkForward(db, { sort: "name" }, 5);
    const names = ids.map((id) => everything.find((r) => r.id === id)!.name);
    const sorted = [...names].sort(compareNoCase);
    expect(names).toEqual(sorted);
    expect(new Set(ids).size).toBe(everything.length);
  });
});

describe("the out-of-stock filter, thumbnails and colour counts", () => {
  test("only products with at least one out-of-stock colour pass; the row shows how many", async () => {
    const db = createTestD1();
    const all = (await listAdminProducts(db, { sort: "name" })).products;
    expect(all.every((p) => p.outOfStockColours === 0)).toBe(true);
    const target = all[0]!;
    db.sqlite.run(
      "UPDATE product_variants SET availability = 'out_of_stock' WHERE product_id = ? AND position IN (0, 1)",
      [target.id],
    );
    const filtered = await listAdminProducts(db, { sort: "name", outOfStock: true });
    expect(filtered.products.map((p) => p.id)).toEqual([target.id]);
    expect(filtered.products[0]?.outOfStockColours).toBe(Math.min(2, target.variantCount));
  });

  test("the thumbnail is the first picture of the first colour that has one", async () => {
    const db = createTestD1();
    db.sqlite.run(
      `INSERT INTO products (id, slug, name, category_id, price, status, revision) VALUES (900, 'thumb', 'Thumb', 'drinkware', 500, 'draft', 'r')`,
    );
    db.sqlite.run(
      "INSERT INTO product_variants (id, product_id, position, name, swatch) VALUES (9001, 900, 0, 'Bare', '#fff'), (9002, 900, 1, 'Second', '#000'), (9003, 900, 2, 'Third', '#111')",
    );
    db.sqlite.run(
      "INSERT INTO product_images (variant_id, position, path) VALUES (9002, 0, 'products/900/b.webp'), (9002, 1, 'products/900/c.webp'), (9003, 0, 'products/900/d.webp')",
    );
    const [row] = (await listAdminProducts(db, { sort: "updated", status: "draft" }, "https://img.example")).products;
    expect(row).toMatchObject({ id: 900, variantCount: 3, thumbnail: "https://img.example/products/900/b.webp" });
    db.sqlite.run("DELETE FROM product_images WHERE variant_id IN (9002, 9003)");
    expect((await listAdminProducts(db, { sort: "updated", status: "draft" })).products[0]?.thumbnail).toBeNull();
  });

  test("the list never carries a field a public page could show by mistake: it is the Owner's shape only", async () => {
    const db = createTestD1();
    const { products } = await listAdminProducts(db, { sort: "updated" });
    expect(products[0]).toHaveProperty("costPrice");
    expect(products[0]).toHaveProperty("status");
  });
});

describe("counts and the name list", () => {
  test("counts per status come from one grouped query, for all products or one category", async () => {
    const db = createTestD1();
    const rows = seed(db, 90);
    const total = (db.sqlite.query("SELECT count(*) AS n FROM products").get() as { n: number }).n;
    const counts = await countAdminProducts(db);
    expect(counts.all).toBe(total);
    expect(counts.draft + counts.published + counts.archived).toBe(total);
    expect(counts.published).toBe(
      (db.sqlite.query("SELECT count(*) AS n FROM products WHERE status = 'published'").get() as { n: number }).n,
    );
    const inCategory = await countAdminProducts(db, "drinkware");
    const expected = (status: ProductStatus) =>
      (
        db.sqlite
          .query("SELECT count(*) AS n FROM products WHERE category_id = 'drinkware' AND status = ?")
          .get(status) as { n: number }
      ).n;
    expect(inCategory).toEqual({
      all: expected("draft") + expected("published") + expected("archived"),
      draft: expected("draft"),
      published: expected("published"),
      archived: expected("archived"),
    });
    expect(rows.length).toBe(90);
    // One statement per call, whatever the number of statuses.
    const seen: string[] = [];
    const metered = createTestD1({ observe: (sql) => seen.push(sql) });
    await countAdminProducts(metered);
    expect(seen).toEqual([countsSql(false)]);
  });

  test("the name list returns id, name, slug and status of every product, nothing else", async () => {
    const db = createTestD1();
    seed(db, 30);
    const names = await listProductNames(db);
    expect(names).toHaveLength((db.sqlite.query("SELECT count(*) AS n FROM products").get() as { n: number }).n);
    expect(Object.keys(names[0]!).sort()).toEqual(["id", "name", "slug", "status"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Query plans (code-standards, D1 read budget)

describe("query plans (EXPLAIN QUERY PLAN on the real migrations)", () => {
  const db = createTestD1();
  seed(db, 50);
  const plan = (sql: string, params: unknown[] = []) =>
    (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
      (row) => row.detail,
    );
  const cursor = (sort: AdminProductSort) =>
    encodeCursor(
      sort.startsWith("price")
        ? { key: 400, id: 1000 }
        : sort === "name"
          ? { key: "Mug", id: 1000 }
          : { key: STAMPS[3]!, id: 1000 },
    );

  test("no combination of filters, sort and direction scans products, colours or pictures, or builds a temp B-tree", () => {
    let checked = 0;
    for (const base of allQueries()) {
      const token = cursor(base.sort);
      for (const variant of [{}, { after: token }, { before: token }] as const) {
        for (const statement of buildListStatements({ ...base, ...variant })) {
          const lines = plan(statement.sql, statement.params);
          expect(
            lines.filter((line) => /\bSCAN\b/.test(line)),
            `${JSON.stringify(base)} ${statement.sql}`,
          ).toEqual([]);
          expect(lines.filter((line) => /TEMP B-TREE/.test(line))).toEqual([]);
          expect(lines[0]).toMatch(/^SEARCH p USING (?:COVERING )?INDEX idx_products_\w+ \(/);
          checked++;
        }
      }
    }
    // 64 filter combinations, each as first page, next page and previous page (name sorts run two statements).
    expect(checked).toBe(224);
  });

  test("the index a combination uses starts with its equality filters", () => {
    const first = (query: AdminProductQuery) => {
      const [statement] = buildListStatements(query);
      return plan(statement!.sql, statement!.params)[0];
    };
    expect(first({ sort: "updated" })).toContain("idx_products_updated (updated_at<?)");
    expect(first({ sort: "updated", status: "draft" })).toContain(
      "idx_products_status_updated (status=? AND updated_at<?)",
    );
    expect(first({ sort: "price_asc", category: "x" })).toContain(
      "idx_products_category_price (category_id=? AND price>?)",
    );
    expect(first({ sort: "price_desc", category: "x", status: "published" })).toContain(
      "idx_products_category_status_price (category_id=? AND status=? AND price<?)",
    );
    expect(first({ sort: "name", status: "published" })).toContain("idx_products_status_name (status=? AND name>?)");
  });

  test("the out-of-stock filter probes the partial index, once per candidate", () => {
    const [statement] = buildListStatements({ sort: "updated", outOfStock: true });
    const lines = plan(statement!.sql, statement!.params);
    expect(lines).toContain("SEARCH v EXISTS USING COVERING INDEX idx_variants_out_of_stock (product_id=?)");
  });

  test("a page's colours start at json_each and use the UNIQUE indexes", () => {
    const lines = plan(PAGE_COLOURS_SQL, ["[1,2,3]"]);
    expect(lines.filter((line) => /\bSCAN\b/.test(line) && !/ j\b/.test(line))).toEqual([]);
    expect(lines.some((line) => line.includes("SEARCH v USING INDEX sqlite_autoindex_product_variants_1"))).toBe(true);
    expect(lines.some((line) => line.includes("SEARCH i USING INDEX sqlite_autoindex_product_images_1"))).toBe(true);
    expect(lines.filter((line) => /TEMP B-TREE/.test(line))).toEqual([]);
  });

  test("counts walk a covering index (all) or search one category; neither needs a temp B-tree", () => {
    const all = plan(countsSql(false));
    expect(all.filter((line) => /TEMP B-TREE/.test(line))).toEqual([]);
    expect(all[0]).toMatch(/^SCAN products USING COVERING INDEX idx_products_/);
    const inCategory = plan(countsSql(true), ["drinkware"]);
    expect(inCategory.filter((line) => /TEMP B-TREE/.test(line))).toEqual([]);
    expect(inCategory[0]).toMatch(/^SEARCH products USING COVERING INDEX idx_products_category_\w+ \(category_id=\?\)/);
  });

  test("the name list is the one deliberate full read, with no ORDER BY and no temp B-tree", () => {
    const lines = plan(PRODUCT_NAMES_SQL);
    expect(lines).toEqual(["SCAN products"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers

describe("cursors, URL search and page slicing", () => {
  test("a cursor round-trips through its token, including names with accents and quotes", () => {
    for (const [sort, key] of [
      ["name", "Ünder 'plate' 50% ✓"],
      ["updated", "2026-11-10T08:00:00.000Z"],
      ["price_asc", 1200],
    ] as const) {
      expect(decodeCursor(encodeCursor({ key, id: 42 }), sort)).toEqual({ key, id: 42 });
    }
  });

  test("a name cursor survives the URL parser for the longest names, multi-byte or escaped", () => {
    // Names allow 120 characters: Bengali is 3 bytes each in UTF-8, and control characters escape to 6 in JSON.
    for (const key of ["ক".repeat(120), "\u0001".repeat(120)]) {
      const token = encodeCursor({ key, id: 2_147_483_647 });
      expect(parseAdminProductSearch({ sort: "name", after: token }).after).toBe(token);
      expect(decodeCursor(token, "name")).toEqual({ key, id: 2_147_483_647 });
    }
  });

  test("a cursor with the wrong kind of key or a malformed token is refused", () => {
    expect(decodeCursor(encodeCursor({ key: "text", id: 1 }), "price_asc")).toBeNull();
    expect(decodeCursor(encodeCursor({ key: 5, id: 1 }), "name")).toBeNull();
    expect(decodeCursor(encodeCursor({ key: "yesterday", id: 1 }), "updated")).toBeNull();
    expect(decodeCursor(encodeCursor({ key: 5, id: 0 }), "price_asc")).toBeNull();
    expect(decodeCursor("%%%", "name")).toBeNull();
    expect(decodeCursor("e30", "name")).toBeNull();
  });

  test("the URL parser keeps valid params and drops the rest, so a bad link opens the first page", () => {
    const good = encodeCursor({ key: 400, id: 3 });
    expect(
      parseAdminProductSearch({
        status: "draft",
        category: "drinkware",
        outOfStock: true,
        sort: "price_asc",
        after: good,
      }),
    ).toEqual({
      status: "draft",
      category: "drinkware",
      outOfStock: true,
      sort: "price_asc",
      after: good,
    });
    expect(parseAdminProductSearch({ status: "gone", sort: "nope", outOfStock: "yes", after: "x" })).toEqual({});
    // A cursor made for another sort is dropped.
    expect(parseAdminProductSearch({ sort: "name", after: good })).toEqual({ sort: "name" });
    // after wins over before.
    expect(parseAdminProductSearch({ sort: "price_asc", after: good, before: good })).toEqual({
      sort: "price_asc",
      after: good,
    });
    expect(withDefaultSort({}).sort).toBe("updated");
    expect(firstPage({ sort: "updated", after: good, status: "draft" })).toEqual({ sort: undefined, status: "draft" });
  });

  test("slicing a page: the extra row says more exist, and backward pages are put back in order", () => {
    const key = (row: number) => ({ key: row, id: row });
    const forward = sliceAdminPage([1, 2, 3, 4], "first", key, 3);
    expect(forward.rows).toEqual([1, 2, 3]);
    expect(forward.next).toBe(encodeCursor(key(3)));
    expect(forward.prev).toBeNull();
    const last = sliceAdminPage([4, 5], "after", key, 3);
    expect(last.next).toBeNull();
    expect(last.prev).toBe(encodeCursor(key(4)));
    const back = sliceAdminPage([3, 2, 1, 0], "before", key, 3);
    expect(back.rows).toEqual([1, 2, 3]);
    expect(back.prev).toBe(encodeCursor(key(1)));
    expect(back.next).toBe(encodeCursor(key(3)));
    const backToStart = sliceAdminPage([3, 2], "before", key, 3);
    expect(backToStart.prev).toBeNull();
  });
});

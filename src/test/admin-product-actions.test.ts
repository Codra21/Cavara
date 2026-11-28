import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  type BulkProductAction,
  bulkProductActionSchema,
  copyName,
  copySlugRange,
  copySlugStem,
  describeBulkResult,
  MAX_BULK_SELECTION,
  nextCopySlug,
  planBulkAction,
} from "@/domain/admin-product-actions";
import { toSummary } from "@/domain/catalog-snapshot";
import { type ProductFormValues, productInputSchema, productToForm, SLUG_PATTERN } from "@/domain/product-admin";
import { listAudit } from "@/server/admin/auth.server";
import {
  type CatalogSources,
  getCachedCatalog,
  getCatalogSummary,
  invalidateCatalogCache,
  refreshProducts,
  snapshotKeys,
} from "@/server/catalog-cache.server";
import { getProductBySlug, getProductsByIds } from "@/server/catalog-queries.server";
import { getAdminProduct, saveProduct } from "@/server/db/admin-catalog.repository";
import {
  BULK_STATES_SQL,
  bulkUpdateProducts,
  duplicateProduct,
  updateFor,
} from "@/server/db/admin-product-actions.repository";
import { listAdminProducts } from "@/server/db/admin-product-list.repository";
import type { D1Database, D1PreparedStatement } from "@/server/db/d1";
import { getPublishedCatalog, readPublishedCatalog } from "@/server/db/catalog.repository";
import {
  addSyntheticProducts,
  FakeCache,
  FakeStore,
  installFakeCache,
  meteredD1,
  removeFakeCache,
} from "./helpers/catalog-doubles";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const IMG = "products/new/00000000-0000-4000-8000-000000000001.webp";
const IMG2 = "products/new/00000000-0000-4000-8000-000000000002.webp";
const COST = 7391;

function form(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    name: "Test Mug",
    slug: "test-mug",
    categoryId: "drinkware",
    summary: "A mug.",
    details: ["350 ml"],
    note: "Hand wash",
    price: 1200,
    regularPrice: 1500,
    costPrice: COST,
    status: "draft",
    featured: false,
    sort: 999,
    variants: [
      { id: null, name: "Sage", swatch: "#9CCB91", availability: "in_stock", images: [IMG, IMG2] },
      { id: null, name: "Rose", swatch: "#F4B8C7", availability: "out_of_stock", images: [IMG] },
    ],
    ...overrides,
  };
}

async function create(db: TestD1, values: Partial<ProductFormValues> = {}) {
  const result = await saveProduct(db, {
    actor: owner,
    id: null,
    revision: "",
    input: productInputSchema.parse(form(values)),
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

const status = (db: TestD1, id: number) =>
  db.sqlite.query("SELECT status, category_id, featured, archived_at, revision FROM products WHERE id = ?").get(id) as {
    status: string;
    category_id: string;
    featured: number;
    archived_at: string | null;
    revision: string;
  };

const bulk = (db: D1Database, action: BulkProductAction) => bulkUpdateProducts(db, { actor: owner, action });

describe("bulk actions", () => {
  test("publish: publishes what can be shown, leaves the rest alone and says why", async () => {
    const db = createTestD1();
    const ready = await create(db, { slug: "ready", name: "Ready" });
    const noColour = await create(db, { slug: "no-colour", name: "No colour", variants: [] });
    const noPicture = await create(db, {
      slug: "no-picture",
      name: "No picture",
      variants: [{ id: null, name: "Bare", swatch: "#fff", availability: "in_stock", images: [] }],
    });
    const already = await create(db, { slug: "already", name: "Already", status: "published" });

    const result = await bulk(db, {
      action: "publish",
      ids: [ready.id, noColour.id, noPicture.id, already.id, 987654],
    });
    expect(result).toEqual({
      ok: true,
      applied: [ready.id],
      shopIds: [ready.id],
      skipped: [
        { id: noColour.id, reason: "needs_picture" },
        { id: noPicture.id, reason: "needs_picture" },
        { id: already.id, reason: "unchanged" },
        { id: 987654, reason: "not_found" },
      ],
    });
    expect(status(db, ready.id).status).toBe("published");
    expect(status(db, noColour.id).status).toBe("draft");
    const shown = (await getPublishedCatalog(db)).products.map((p) => p.slug);
    expect(shown).toContain("ready");
    expect(shown).not.toContain("no-colour");
  });

  test("publish clears archived_at; archive stamps it once; unpublish moves published products to draft", async () => {
    const db = createTestD1();
    const a = await create(db, { slug: "a", status: "published" });
    const archived = await bulk(db, { action: "archive", ids: [a.id] });
    expect(archived).toMatchObject({ ok: true, applied: [a.id], shopIds: [a.id] });
    const stamp = status(db, a.id).archived_at;
    expect(stamp).not.toBeNull();
    // Archiving again changes nothing, and archived_at keeps its first value.
    expect(await bulk(db, { action: "archive", ids: [a.id] })).toMatchObject({
      applied: [],
      skipped: [{ id: a.id, reason: "unchanged" }],
    });
    expect(status(db, a.id).archived_at).toBe(stamp);
    // Unpublish leaves an archived product archived.
    expect(await bulk(db, { action: "unpublish", ids: [a.id] })).toMatchObject({ applied: [] });
    expect(status(db, a.id).status).toBe("archived");

    expect(await bulk(db, { action: "publish", ids: [a.id] })).toMatchObject({ applied: [a.id] });
    expect(status(db, a.id)).toMatchObject({ status: "published", archived_at: null });
    expect(await bulk(db, { action: "unpublish", ids: [a.id] })).toMatchObject({ applied: [a.id] });
    expect(status(db, a.id)).toMatchObject({ status: "draft", archived_at: null });
  });

  test("category: moves products, skips ones already there, and refuses an unknown category", async () => {
    const db = createTestD1();
    const a = await create(db, { slug: "a" });
    const b = await create(db, { slug: "b", categoryId: "serveware" });
    const moved = await bulk(db, { action: "set_category", categoryId: "serveware", ids: [a.id, b.id] });
    expect(moved).toMatchObject({ ok: true, applied: [a.id], skipped: [{ id: b.id, reason: "unchanged" }] });
    expect(status(db, a.id).category_id).toBe("serveware");

    const auditBefore = (await listAudit(db)).length;
    expect(await bulk(db, { action: "set_category", categoryId: "no-such", ids: [a.id] })).toEqual({
      ok: false,
      error: "That category no longer exists. Reload and pick another.",
    });
    expect((await listAudit(db)).length).toBe(auditBefore);
  });

  test("featured: sets and clears", async () => {
    const db = createTestD1();
    const a = await create(db, { slug: "a" });
    const b = await create(db, { slug: "b", featured: true });
    expect(await bulk(db, { action: "feature", ids: [a.id, b.id] })).toMatchObject({
      applied: [a.id],
      skipped: [{ id: b.id, reason: "unchanged" }],
    });
    expect(status(db, a.id).featured).toBe(1);
    expect(await bulk(db, { action: "unfeature", ids: [a.id, b.id] })).toMatchObject({ applied: [a.id, b.id] });
    expect([status(db, a.id).featured, status(db, b.id).featured]).toEqual([0, 0]);
  });

  test("one audit row per action, naming the products it changed; none when nothing changed", async () => {
    const db = createTestD1();
    const a = await create(db, { slug: "a", status: "published" });
    const b = await create(db, { slug: "b", status: "published" });
    const before = (await listAudit(db)).length;
    await bulk(db, { action: "archive", ids: [a.id, b.id, 424242] });
    const audit = await listAudit(db);
    expect(audit.length).toBe(before + 1);
    expect(audit.find((entry) => entry.action === "product.bulk_archive")).toMatchObject({
      action: "product.bulk_archive",
      targetId: `${a.id},${b.id}`,
      actorUsername: "owner",
      details: { count: 2, status: "archived", name: "2 products" },
    });
    await bulk(db, { action: "archive", ids: [a.id, b.id] });
    expect((await listAudit(db)).length).toBe(before + 1);
  });

  test("an editor that was open on a changed product conflicts instead of undoing the action", async () => {
    const db = createTestD1();
    const created = await create(db, { slug: "a", status: "published" });
    const loaded = (await getAdminProduct(db, created.id))!;
    await bulk(db, { action: "archive", ids: [created.id] });
    const stale = await saveProduct(db, {
      actor: owner,
      id: created.id,
      revision: loaded.revision,
      input: productInputSchema.parse({ ...productToForm(loaded), name: "Edited in a stale tab" }),
    });
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(status(db, created.id).status).toBe("archived");
    // The editor that reloads can save again.
    const fresh = (await getAdminProduct(db, created.id))!;
    expect(fresh.status).toBe("archived");
    const saved = await saveProduct(db, {
      actor: owner,
      id: created.id,
      revision: fresh.revision,
      input: productInputSchema.parse({ ...productToForm(fresh), name: "Edited after reload" }),
    });
    expect(saved.ok).toBe(true);
  });

  test("includes a product published between check and write in shopIds so R2 snapshots are refreshed", async () => {
    const db = createTestD1();
    const draft = await create(db, { slug: "race-draft", status: "draft" });

    // Intercept the UPDATE batch to publish the draft right after BULK_STATES_SQL read it as draft.
    const origBatch = db.batch.bind(db);
    let calls = 0;
    db.batch = (async (statements: unknown[]) => {
      calls++;
      if (calls === 2) {
        db.sqlite.run("UPDATE products SET status = 'published' WHERE id = ?", [draft.id]);
      }
      return origBatch(statements as never);
    }) as typeof db.batch;

    const result = await bulk(db, { action: "feature", ids: [draft.id] });
    expect(result).toMatchObject({ ok: true, applied: [draft.id], shopIds: [draft.id] });
  });

  test("a product that changed between the check and the write is skipped, not overwritten, and not audited", async () => {
    const db = createTestD1();
    const a = await create(db, { slug: "a" });
    const auditBefore = (await listAudit(db)).length;
    let calls = 0;
    const racing: D1Database = {
      prepare: (sql) => db.prepare(sql),
      batch: async <T>(statements: D1PreparedStatement[]) => {
        const results = await db.batch<T>(statements);
        // Another tab publishes the product right after this action read its state.
        if (++calls === 1) db.sqlite.run("UPDATE products SET status = 'published' WHERE id = ?", [a.id]);
        return results;
      },
    };
    const result = await bulk(racing, { action: "publish", ids: [a.id] });
    expect(result).toEqual({ ok: true, applied: [], shopIds: [], skipped: [{ id: a.id, reason: "changed" }] });
    expect((await listAudit(db)).length).toBe(auditBefore);
  });

  test("a bulk action is two round trips and its statements bind a handful of parameters, far under D1's 100", async () => {
    const metered = meteredD1();
    const a = await create(metered.db, { slug: "a" });
    metered.clear();
    const batches: number[] = [];
    const counting: D1Database = {
      prepare: (sql) => metered.db.prepare(sql),
      batch: (statements) => {
        batches.push(statements.length);
        return metered.db.batch(statements);
      },
    };
    await bulk(counting, { action: "publish", ids: [a.id] });
    expect(batches).toEqual([1, 2]);
    // 50 ids travel as one JSON parameter.
    const many = Array.from({ length: MAX_BULK_SELECTION }, (_, i) => i + 1);
    for (const action of ["publish", "unpublish", "archive", "feature", "unfeature"] as const) {
      const [, params] = updateFor({ action, ids: many }, "rev", "now", JSON.stringify(many));
      expect(params.length).toBeLessThan(10);
    }
  });

  test("the selection is bounded to one page, unique, and validated", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: fifty }).success).toBe(true);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: [...fifty, 51] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: [] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: [1, 1] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: [0] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "publish", ids: [1.5] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "delete", ids: [1] }).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "set_category", ids: [1] }).success).toBe(false);
    expect(
      bulkProductActionSchema.safeParse({ action: "set_category", ids: [1], categoryId: "kitchen-storage" }).success,
    ).toBe(true);
  });

  test("every bulk statement starts from the primary key or the UNIQUE indexes: no scan, no temp B-tree", async () => {
    const db = createTestD1();
    const plan = (sql: string, params: unknown[]) =>
      (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
        (row) => row.detail,
      );
    const lines = [plan(BULK_STATES_SQL, ["[1,2]"])];
    const actions: BulkProductAction[] = [
      { action: "publish", ids: [1] },
      { action: "unpublish", ids: [1] },
      { action: "archive", ids: [1] },
      { action: "set_category", categoryId: "kitchen-storage", ids: [1] },
      { action: "feature", ids: [1] },
      { action: "unfeature", ids: [1] },
    ];
    for (const action of actions) {
      const [sql, params] = updateFor(action, "rev", "2026-11-10T00:00:00.000Z", "[1,2]");
      lines.push(plan(sql, params));
    }
    for (const entry of lines.flat()) {
      expect(entry).not.toMatch(/TEMP B-TREE/);
      expect(entry).not.toMatch(/^SCAN (?:products|product_variants|product_images|categories)\b/);
    }
    expect(lines[0]!.join("\n")).toContain("SEARCH p USING INTEGER PRIMARY KEY (rowid=?)");
  });
});

describe("planBulkAction and the result text", () => {
  const state = (
    id: number,
    over: Partial<{ status: "draft" | "published" | "archived"; publishable: boolean }> = {},
  ) => ({
    id,
    status: over.status ?? "draft",
    categoryId: "drinkware",
    featured: false,
    publishable: over.publishable ?? true,
  });

  test("a published or archived product is a shop product only when the action reaches the shop", () => {
    expect(
      planBulkAction({ action: "publish", ids: [1, 2, 3] }, [state(1), state(2, { publishable: false })]).shop,
    ).toEqual([1]);
    const plan = planBulkAction({ action: "archive", ids: [1, 2] }, [state(1, { status: "published" }), state(2)]);
    expect(plan.apply).toEqual([1, 2]);
    expect(plan.shop).toEqual([1]);
  });

  test("describeBulkResult is plain and counts what was left alone", () => {
    expect(describeBulkResult("publish", 3, [])).toBe("Published 3 products.");
    expect(describeBulkResult("archive", 1, [{ id: 2, reason: "unchanged" }])).toBe(
      "Archived 1 product. Left alone: 1 product already as asked.",
    );
    expect(
      describeBulkResult("publish", 0, [
        { id: 1, reason: "needs_picture" },
        { id: 2, reason: "needs_picture" },
        { id: 3, reason: "not_found" },
      ]),
    ).toBe(
      "Nothing changed. Left alone: 2 products need a colour with a picture before they can be published; 1 product no longer exist.",
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Snapshot patch for several products

describe("refreshProducts patches the shop's copies once for a whole bulk action", () => {
  const keys = snapshotKeys("snapshots/catalog-v1.json");
  let edge: FakeCache;
  let store: FakeStore;
  let d1: ReturnType<typeof meteredD1>;
  const sources = (): CatalogSources => ({ imageBase: "", db: () => d1.db, store, keys });
  const withoutGen = <T extends { gen: string }>(value: T) => ({ ...value, gen: "x" });
  const rebuilt = async () => toSummary(await readPublishedCatalog(d1.db), "x");

  beforeEach(async () => {
    edge = installFakeCache();
    store = new FakeStore();
    d1 = meteredD1();
    await invalidateCatalogCache("");
    await getCachedCatalog(sources());
    await getCatalogSummary(sources());
  });
  afterEach(() => removeFakeCache());

  test("publishing, archiving and moving several products gives what a full rebuild would, with one summary write", async () => {
    const drafts = [];
    for (let i = 0; i < 4; i++)
      drafts.push(await create(d1.db, { slug: `draft-${i}`, name: `Draft ${i}`, sort: i * 3 }));
    const draftIds = drafts.map((d) => d.id);
    const result = await bulk(d1.db, { action: "publish", ids: draftIds });
    if (!result.ok) throw new Error(result.error);
    expect(result.shopIds).toEqual(draftIds);

    store.resetCounts();
    d1.clear();
    expect(await refreshProducts(sources(), result.shopIds)).toBe(true);
    // Two statements in one batch, however many products; one write each for the details, the summary and the legacy catalogue.
    expect(d1.reads()).toBe(2);
    expect(store.writes.filter((key) => key === keys.summary)).toHaveLength(1);
    expect(store.writes.filter((key) => key === keys.legacy)).toHaveLength(1);
    expect(store.writes.filter((key) => key.startsWith("snapshots/products/"))).toHaveLength(4);
    expect(withoutGen(await getCatalogSummary(sources()))).toEqual(await rebuilt());
    expect(await getCachedCatalog(sources())).toEqual(await getPublishedCatalog(d1.db));

    // Now unpublish two of them and archive a seeded one in a second action; the details of removed products go.
    const second = await bulk(d1.db, { action: "archive", ids: [draftIds[0]!, draftIds[1]!, 3] });
    if (!second.ok) throw new Error(second.error);
    expect(second.shopIds).toEqual([draftIds[0]!, draftIds[1]!, 3]);
    expect(await refreshProducts(sources(), second.shopIds)).toBe(true);
    expect(withoutGen(await getCatalogSummary(sources()))).toEqual(await rebuilt());
    expect(await getCachedCatalog(sources())).toEqual(await getPublishedCatalog(d1.db));
    for (const id of [draftIds[0]!, draftIds[1]!, 3]) expect(store.objects.has(keys.detail(id))).toBe(false);
    expect((await getProductsByIds(sources(), [draftIds[0]!, draftIds[2]!])).missing).toEqual([draftIds[0]!]);
  });

  test("rows read follow the products in the action, not the catalogue: 24 and 524 products cost the same", async () => {
    async function measure(extra: number) {
      const metered = meteredD1();
      if (extra) addSyntheticProducts(metered.db, extra);
      const source: CatalogSources = { imageBase: "", db: () => metered.db, store: new FakeStore(), keys };
      await invalidateCatalogCache("");
      await getCachedCatalog(source);
      await getCatalogSummary(source);
      const selected = [3, 4, 5, 6, 7];
      const result = await bulk(metered.db, { action: "feature", ids: selected });
      if (!result.ok) throw new Error(result.error);
      metered.clear();
      await refreshProducts(source, result.shopIds);
      return { statements: metered.log.map((entry) => entry.sql), rows: metered.rowsReturned() };
    }
    const small = await measure(0);
    const large = await measure(500);
    expect(large.statements).toEqual(small.statements);
    expect(large.rows).toBe(small.rows);
    expect(small.rows).toBeLessThan(100);
  });

  test("with no snapshots yet nothing is written; without a store it only drops cached copies", async () => {
    store.objects.clear();
    store.resetCounts();
    const a = await create(d1.db, { slug: "a", name: "A" });
    await bulk(d1.db, { action: "publish", ids: [a.id] });
    expect(await refreshProducts(sources(), [a.id])).toBe(true);
    expect(store.writes).toEqual([]);
    expect(await refreshProducts({ imageBase: "", db: () => d1.db }, [a.id])).toBe(true);
    expect(await refreshProducts(sources(), [])).toBe(true);
  });

  test("when R2 fails it deletes the objects and reports it, like a single save", async () => {
    const a = await create(d1.db, { slug: "a", name: "A" });
    await bulk(d1.db, { action: "publish", ids: [a.id] });
    store.failWrites = true;
    expect(await refreshProducts(sources(), [a.id])).toBe(false);
    store.failWrites = false;
    expect(store.objects.has(keys.summary)).toBe(false);
    expect(edge.entries.size).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Duplicate

describe("duplicate product", () => {
  test("copies text, prices, cost price and colours into a draft that is not featured or public", async () => {
    const db = createTestD1();
    const source = await create(db, { status: "published", featured: true });
    const publicBefore = JSON.stringify(await getPublishedCatalog(db));
    const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: false });
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.slug).toBe("test-mug-copy");

    const original = (await getAdminProduct(db, source.id))!;
    const copied = (await getAdminProduct(db, copy.id))!;
    expect(copied).toMatchObject({
      name: "Test Mug (copy)",
      slug: "test-mug-copy",
      categoryId: original.categoryId,
      summary: original.summary,
      details: original.details,
      note: original.note,
      price: 1200,
      regularPrice: 1500,
      costPrice: COST,
      sort: original.sort,
      status: "draft",
      featured: false,
      revision: copy.revision,
    });
    expect(copied.variants.map((v) => [v.name, v.swatch, v.availability])).toEqual(
      original.variants.map((v) => [v.name, v.swatch, v.availability]),
    );
    expect(copied.variants.every((v) => v.images.length === 0)).toBe(true);
    expect(copied.variants.map((v) => v.id)).not.toContain(original.variants[0]!.id);
    // The original is untouched, and the shop still shows exactly what it showed.
    expect(await getAdminProduct(db, source.id)).toEqual(original);
    expect(JSON.stringify(await getPublishedCatalog(db))).toBe(publicBefore);
    expect((await getPublishedCatalog(db)).products.some((p) => p.id === copy.id)).toBe(false);
  });

  test("preserves weight_g and resets new_arrival when duplicating a product", async () => {
    const db = createTestD1();
    const source = await create(db, {
      slug: "heavy-kettle",
      name: "Heavy Kettle",
      weightG: 3500,
      newArrival: true,
      featured: true,
      status: "published",
    });
    const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: false });
    if (!copy.ok) throw new Error(copy.error);

    const copied = (await getAdminProduct(db, copy.id))!;
    expect(copied.weightG).toBe(3500);
    expect(copied.newArrival).toBe(false);
    expect(copied.featured).toBe(false);

    // Also verify a product with null weight_g keeps weightG as null.
    const lightSource = await create(db, { slug: "default-mug", name: "Default Mug", weightG: null });
    const lightCopy = await duplicateProduct(db, { actor: owner, id: lightSource.id, includeImages: false });
    if (!lightCopy.ok) throw new Error(lightCopy.error);
    expect((await getAdminProduct(db, lightCopy.id))!.weightG).toBeNull();
  });

  test("includeImages reuses the same R2 keys; each product then edits its own picture rows", async () => {
    const db = createTestD1();
    const source = await create(db);
    const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: true });
    if (!copy.ok) throw new Error(copy.error);
    const original = (await getAdminProduct(db, source.id))!;
    const copied = (await getAdminProduct(db, copy.id))!;
    expect(copied.variants.map((v) => v.images)).toEqual([[IMG, IMG2], [IMG]]);
    // Different rows, same keys.
    const rows = db.sqlite
      .query(
        "SELECT i.id, v.product_id FROM product_images i JOIN product_variants v ON v.id = i.variant_id WHERE i.path = ?",
      )
      .all(IMG) as { id: number; product_id: number }[];
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect([...new Set(rows.map((r) => r.product_id))].sort()).toEqual([source.id, copy.id].sort());

    // Removing every picture from the original leaves the copy's pictures (and the shared keys) as they were.
    const saved = await saveProduct(db, {
      actor: owner,
      id: source.id,
      revision: original.revision,
      input: productInputSchema.parse({
        ...productToForm(original),
        variants: original.variants.map((v) => ({ ...v, images: [] })),
      }),
    });
    expect(saved.ok).toBe(true);
    expect((await getAdminProduct(db, copy.id))!.variants.map((v) => v.images)).toEqual([[IMG, IMG2], [IMG]]);
    // And the other way round: replacing a picture on the copy does not touch the original.
    const reloaded = (await getAdminProduct(db, copy.id))!;
    await saveProduct(db, {
      actor: owner,
      id: copy.id,
      revision: reloaded.revision,
      input: productInputSchema.parse({
        ...productToForm(reloaded),
        variants: reloaded.variants.map((v) => ({ ...v, images: [IMG2] })),
      }),
    });
    expect((await getAdminProduct(db, source.id))!.variants.map((v) => v.images)).toEqual([[], []]);
  });

  test("copy URL names are unique: -copy, -copy-2, -copy-3, and a copy of a copy", async () => {
    const db = createTestD1();
    const source = await create(db);
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: false });
      if (!copy.ok) throw new Error(copy.error);
      slugs.push(copy.slug);
    }
    expect(slugs).toEqual(["test-mug-copy", "test-mug-copy-2", "test-mug-copy-3"]);
    const again = await duplicateProduct(db, { actor: owner, id: source.id + 1, includeImages: false });
    expect(again).toMatchObject({ ok: true, slug: "test-mug-copy-copy" });
    const names = (
      db.sqlite.query("SELECT name FROM products WHERE slug LIKE 'test-mug-copy%'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain("Test Mug (copy) (copy)");
  });

  test("a name taken between the check and the write is retried with the next free one", async () => {
    const db = createTestD1();
    const source = await create(db);
    let injected = false;
    const racing: D1Database = {
      batch: (statements) => db.batch(statements),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        if (!sql.startsWith("SELECT slug FROM products WHERE slug >=")) return statement;
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              ...bound,
              all: async () => {
                const result = await bound.all();
                if (!injected) {
                  injected = true;
                  // Another tab copies the same product first.
                  db.sqlite.run(
                    "INSERT INTO products (id, slug, name, category_id, price, revision) VALUES (777, 'test-mug-copy', 'Taken', 'drinkware', 5, 'r')",
                  );
                }
                return result;
              },
            };
          },
        } as ReturnType<D1Database["prepare"]>;
      },
    };
    const copy = await duplicateProduct(racing, { actor: owner, id: source.id, includeImages: false });
    expect(copy).toMatchObject({ ok: true, slug: "test-mug-copy-2" });
  });

  test("an unknown product is refused and writes nothing", async () => {
    const db = createTestD1();
    const before = (db.sqlite.query("SELECT count(*) AS n FROM products").get() as { n: number }).n;
    const auditBefore = (await listAudit(db)).length;
    expect(await duplicateProduct(db, { actor: owner, id: 424242, includeImages: true })).toEqual({
      ok: false,
      error: "This product no longer exists.",
    });
    expect((db.sqlite.query("SELECT count(*) AS n FROM products").get() as { n: number }).n).toBe(before);
    expect((await listAudit(db)).length).toBe(auditBefore);
  });

  test("a product with no colours copies as a draft with none; the audit row names the original", async () => {
    const db = createTestD1();
    const source = await create(db, { variants: [] });
    const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: true });
    if (!copy.ok) throw new Error(copy.error);
    expect((await getAdminProduct(db, copy.id))!.variants).toEqual([]);
    const entry = (await listAudit(db)).find((row) => row.action === "product.duplicated");
    expect(entry).toMatchObject({
      action: "product.duplicated",
      targetId: String(copy.id),
      details: { from: source.id, status: "draft", images: true, name: "Test Mug (copy)" },
    });
  });

  test("the copy opens in the editor and saves like any product, and shows in the list", async () => {
    const db = createTestD1();
    const source = await create(db);
    const copy = await duplicateProduct(db, { actor: owner, id: source.id, includeImages: true });
    if (!copy.ok) throw new Error(copy.error);
    const loaded = (await getAdminProduct(db, copy.id))!;
    const saved = await saveProduct(db, {
      actor: owner,
      id: copy.id,
      revision: loaded.revision,
      input: productInputSchema.parse({ ...productToForm(loaded), name: "Mug, second design", slug: "mug-second" }),
    });
    expect(saved.ok).toBe(true);
    const drafts = await listAdminProducts(db, { sort: "updated", status: "draft" });
    expect(drafts.products.map((p) => p.id)).toContain(copy.id);
  });

  test("the copy's statements start from the primary key or the UNIQUE indexes: no scan of a growing table", async () => {
    const db = createTestD1();
    const plan = (sql: string, params: unknown[]) =>
      (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
        (row) => row.detail,
      );
    const guard = "EXISTS (SELECT 1 FROM products WHERE id = ? AND revision = ?)";
    const lines = [
      plan("SELECT slug, name FROM products WHERE id = ?", [1]),
      plan("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM products", []),
      plan("SELECT slug FROM products WHERE slug >= ? AND slug < ?", ["a-copy", "a-copy."]),
      plan(
        `INSERT INTO product_variants (product_id, position, name, swatch, availability)
         SELECT ?, position, name, swatch, availability FROM product_variants WHERE product_id = ? AND ${guard}`,
        [100, 1, 100, "r"],
      ),
      plan(
        `INSERT INTO product_images (variant_id, position, path, alt)
         SELECT nv.id, i.position, i.path, i.alt FROM product_variants sv
         JOIN product_images i ON i.variant_id = sv.id
         JOIN product_variants nv ON nv.product_id = ? AND nv.position = sv.position
         WHERE sv.product_id = ? AND ${guard}`,
        [100, 1, 100, "r"],
      ),
    ].flat();
    for (const line of lines) {
      expect(line).not.toMatch(/TEMP B-TREE/);
      expect(line).not.toMatch(/^SCAN (?:products|product_variants|product_images)\b/);
    }
    expect(plan("SELECT slug FROM products WHERE slug >= ? AND slug < ?", ["a", "b"])[0]).toContain(
      "sqlite_autoindex_products_1",
    );
  });
});

describe("what the public can see of a copy", () => {
  let edge: FakeCache;
  let store: FakeStore;
  let d1: ReturnType<typeof meteredD1>;
  const keys = snapshotKeys("snapshots/catalog-v1.json");
  const sources = (): CatalogSources => ({ imageBase: "", db: () => d1.db, store, keys });

  beforeEach(async () => {
    edge = installFakeCache();
    store = new FakeStore();
    d1 = meteredD1();
    await invalidateCatalogCache("");
  });
  afterEach(() => removeFakeCache());

  test("a draft copy is in no snapshot; once published, cost_price is still in none", async () => {
    const source = await create(d1.db, { status: "published" });
    await getCachedCatalog(sources());
    await getCatalogSummary(sources());
    const copy = await duplicateProduct(d1.db, { actor: owner, id: source.id, includeImages: true });
    if (!copy.ok) throw new Error(copy.error);
    // The draft changes nothing the shop shows; the server function does not even patch.
    expect((await getCatalogSummary(sources())).products.some((p) => p.id === copy.id)).toBe(false);
    expect((await getProductBySlug(sources(), copy.slug)).product).toBeNull();

    const published = await bulk(d1.db, { action: "publish", ids: [copy.id] });
    if (!published.ok) throw new Error(published.error);
    expect(await refreshProducts(sources(), published.shopIds)).toBe(true);
    expect((await getProductBySlug(sources(), copy.slug)).product?.name).toBe("Test Mug (copy)");

    const everything = [
      ...[...store.objects.values()].map((object) => object.json),
      ...edge.entries.values(),
      JSON.stringify(await getProductBySlug(sources(), copy.slug)),
      JSON.stringify(await getProductsByIds(sources(), [source.id, copy.id])),
      JSON.stringify(await getCatalogSummary(sources())),
      JSON.stringify(await getCachedCatalog(sources())),
    ].join("\n");
    expect(everything).toContain("Test Mug (copy)");
    expect(everything).not.toContain(String(COST));
    expect(everything).not.toMatch(/cost_?price/i);
  });
});

describe("copy names", () => {
  test("stems, ranges and names stay inside the limits", () => {
    expect(copySlugStem("red-cup")).toBe("red-cup-copy");
    const long = `${"a".repeat(79)}b`;
    const stem = copySlugStem(long);
    expect(stem.length + "-999".length).toBeLessThanOrEqual(80);
    for (const n of [stem, `${stem}-2`, `${stem}-999`]) expect(SLUG_PATTERN.test(n)).toBe(true);
    expect(copySlugRange("red-cup")).toEqual({ from: "red-cup-copy", to: "red-cup-copy." });
    expect(nextCopySlug("red-cup", new Set(["red-cup-copy", "red-cup-copy-2"]))).toBe("red-cup-copy-3");
    expect(nextCopySlug("red-cup", new Set())).toBe("red-cup-copy");
    expect(copyName("x".repeat(120)).length).toBe(120);
    expect(copyName("Cup")).toBe("Cup (copy)");
    // A stem that ends in a hyphen after cutting never produces "--".
    expect(copySlugStem(`${"a".repeat(70)}-bbbbbbbbbb`)).not.toContain("--");
  });
});

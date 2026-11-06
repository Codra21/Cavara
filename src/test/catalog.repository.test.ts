import { describe, expect, test } from "bun:test";
import type { Product, Variant } from "@/lib/types";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { CATEGORIES, PRODUCTS } from "../../scripts/seed/catalog-data";
import { createTestD1, migrationFiles } from "./helpers/d1";

describe("migrations", () => {
  test("apply cleanly to an empty database", () => {
    expect(migrationFiles()).toEqual([
      "0001_catalog.sql",
      "0002_seed_catalog.sql",
      "0003_admin_auth.sql",
      "0004_product_revision.sql",
      "0005_images_to_r2.sql",
      "0006_orders.sql",
      "0007_order_change_token.sql",
      "0008_order_outbox.sql",
    ]);
    const db = createTestD1();
    const count = (table: string) => (db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("categories")).toBe(CATEGORIES.length);
    expect(count("products")).toBe(PRODUCTS.length);
    expect(count("product_variants")).toBe(PRODUCTS.reduce((sum, p) => sum + p.variants.length, 0));
    expect(count("product_images")).toBe(
      PRODUCTS.reduce((sum, p) => sum + p.variants.reduce((s, v) => s + v.images.length, 0), 0),
    );
  });

  test("schema rejects invalid prices and statuses", () => {
    const db = createTestD1({ migrations: ["0001_catalog.sql"] });
    db.sqlite.run("INSERT INTO categories (id, name, image) VALUES ('c', 'C', '/c.webp')");
    expect(() =>
      db.sqlite.run("INSERT INTO products (id, slug, name, category_id, price) VALUES (1, 'a', 'A', 'c', 0)"),
    ).toThrow();
    expect(() =>
      db.sqlite.run(
        "INSERT INTO products (id, slug, name, category_id, price, status) VALUES (1, 'a', 'A', 'c', 10, 'live')",
      ),
    ).toThrow();
    expect(() =>
      db.sqlite.run("INSERT INTO products (id, slug, name, category_id, price) VALUES (1, 'a', 'A', 'missing', 10)"),
    ).toThrow();
  });
});

describe("getPublishedCatalog", () => {
  test("round-trips the seed data, in display order, with images served from R2", async () => {
    const catalog = await getPublishedCatalog(createTestD1());
    // Seed paths are "/product-images/…"; 0005 turns them into R2 keys, served at /media/<key> with no IMAGE_BASE_URL.
    const media = (path: string) => `/media${path}`;
    expect(catalog.imageBase).toBe("");
    expect(catalog.categories).toEqual(CATEGORIES.map((category) => ({ ...category, image: media(category.image) })));
    // The seed source has no availability; D1 defaults every colour to in stock.
    const expected: Product[] = PRODUCTS.map((product) => {
      const [first, ...rest] = product.variants.map((variant): Variant => ({
        ...variant,
        images: variant.images.map(media),
        availability: "in_stock",
      }));
      return { ...product, variants: [first!, ...rest] };
    });
    expect(catalog.products).toEqual(expected);
  });

  test("returns only published products and never cost_price", async () => {
    const db = createTestD1();
    const [first, second] = PRODUCTS;
    db.sqlite.run("UPDATE products SET status = 'draft' WHERE id = ?", [first!.id]);
    db.sqlite.run("UPDATE products SET status = 'archived', cost_price = 500 WHERE id = ?", [second!.id]);
    db.sqlite.run("UPDATE products SET cost_price = 900");
    const catalog = await getPublishedCatalog(db);
    expect(catalog.products.map((p) => p.id)).not.toContain(first!.id);
    expect(catalog.products.map((p) => p.id)).not.toContain(second!.id);
    expect(catalog.products).toHaveLength(PRODUCTS.length - 2);
    expect(JSON.stringify(catalog)).not.toContain("cost");
  });

  test("follows the sort column", async () => {
    const db = createTestD1();
    const last = PRODUCTS.at(-1)!;
    db.sqlite.run("UPDATE products SET sort = -1 WHERE id = ?", [last.id]);
    const catalog = await getPublishedCatalog(db);
    expect(catalog.products[0]?.id).toBe(last.id);
  });

  test("skips a product with no colours instead of failing the page", async () => {
    const db = createTestD1();
    const target = PRODUCTS[0]!;
    db.sqlite.run("DELETE FROM product_variants WHERE product_id = ?", [target.id]);
    const catalog = await getPublishedCatalog(db);
    expect(catalog.products.map((p) => p.id)).not.toContain(target.id);
  });

  test("fails loudly on corrupt details JSON", async () => {
    const db = createTestD1();
    db.sqlite.run("UPDATE products SET details = 'not json' WHERE id = ?", [PRODUCTS[0]!.id]);
    expect(getPublishedCatalog(db)).rejects.toThrow("not a JSON array");
  });
});

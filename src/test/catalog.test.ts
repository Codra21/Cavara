import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { filterProducts, formatPrice, getVariant, indexCatalog } from "@/domain/catalog";
import { bagSubtotal } from "@/lib/order";
import { CATEGORIES, PRODUCTS } from "../../scripts/seed/catalog-data";

const catalog = indexCatalog({ categories: CATEGORIES, products: PRODUCTS, imageBase: "" });

// The seed source for migrations/0002_seed_catalog.sql; checked before it reaches D1.
describe("catalogue data", () => {
  test("product ids and slugs are unique", () => {
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    expect(new Set(PRODUCTS.map((p) => p.slug)).size).toBe(PRODUCTS.length);
  });

  test("every product belongs to a known category and has a whole-BDT price", () => {
    const categories = new Set(CATEGORIES.map((c) => c.id));
    for (const product of PRODUCTS) {
      expect(categories.has(product.category)).toBe(true);
      expect(Number.isInteger(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
    }
  });

  test("every image path points at a file in public/", () => {
    const paths = [...CATEGORIES.map((c) => c.image), ...PRODUCTS.flatMap((p) => p.variants.flatMap((v) => v.images))];
    const missing = paths.filter((path) => !existsSync(join(import.meta.dir, "../../public", path)));
    expect(missing).toEqual([]);
  });

  test("every variant has at least one image", () => {
    for (const product of PRODUCTS) {
      for (const variant of product.variants) expect(variant.images.length).toBeGreaterThan(0);
    }
  });
});

describe("catalogue helpers", () => {
  test("getVariant falls back to the first variant", () => {
    const product = PRODUCTS[0]!;
    expect(getVariant(product, 999)).toBe(product.variants[0]);
  });

  test("filterProducts narrows by category", () => {
    const category = CATEGORIES[0]!.id;
    const result = filterProducts(catalog, { category, query: "", sort: "featured" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.category === category)).toBe(true);
  });

  test("formatPrice uses the taka sign and thousands separators", () => {
    expect(formatPrice(1550)).toBe("৳ 1,550");
  });

  test("bagSubtotal multiplies price by quantity and ignores unknown ids", () => {
    const product = PRODUCTS[0]!;
    expect(
      bagSubtotal(catalog, [
        { id: product.id, variant: 0, qty: 3 },
        { id: -1, variant: 0, qty: 5 },
      ]),
    ).toBe(product.price * 3);
  });
});

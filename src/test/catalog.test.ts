import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatPrice, getVariant, isCategorySlug, isProductSlug } from "@/domain/catalog";
import { CATEGORIES, PRODUCTS } from "../../scripts/seed/catalog-data";

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

  // The originals live in Cavara/product-images/ (git-ignored, not in public/ so they never ship in dist/client).
  // A fresh clone or CI checkout has no such folder; the check then has nothing to look at and is skipped.
  const originals = join(import.meta.dir, "../..");
  test.skipIf(!existsSync(join(originals, "product-images")))(
    "every image path points at an original in product-images/",
    () => {
      const paths = [
        ...CATEGORIES.map((c) => c.image),
        ...PRODUCTS.flatMap((p) => p.variants.flatMap((v) => v.images)),
      ];
      const missing = paths.filter((path) => !existsSync(join(originals, path)));
      expect(missing).toEqual([]);
    },
  );

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

  test("isCategorySlug accepts ids shaped like the seeded ones and nothing else", () => {
    for (const category of CATEGORIES) expect(isCategorySlug(category.id)).toBe(true);
    for (const bad of ["", "Bad Id", "a/b", "x".repeat(65), 5, null]) expect(isCategorySlug(bad)).toBe(false);
  });

  test("isProductSlug accepts what the editor writes and nothing else", () => {
    expect(isProductSlug("ceramic-foaming-bottle")).toBe(true);
    for (const bad of ["", "Bad.Slug", "a--b", "-a", "a b", "x".repeat(81), 5, null])
      expect(isProductSlug(bad)).toBe(false);
  });

  test("formatPrice uses the taka sign and thousands separators", () => {
    expect(formatPrice(1550)).toBe("৳ 1,550");
  });
});

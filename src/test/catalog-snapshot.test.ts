import { describe, expect, test } from "bun:test";
import {
  type CatalogSummary,
  decodeDetail,
  decodeSummary,
  detailIsCurrent,
  encodeDetail,
  encodeSummary,
  newGeneration,
  patchLegacyProduct,
  patchSummaryProduct,
  predecessorId,
  type ProductSummary,
  resolveCard,
  summaryIndex,
} from "@/domain/catalog-snapshot";
import type { Catalog, Product } from "@/lib/types";

function product(id: number, over: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id,
    slug: `p-${id}`,
    name: `Product ${id}`,
    category: "drinkware",
    price: 100 + id,
    regularPrice: null,
    featured: false,
    createdAt: "2026-11-01",
    sort: id * 10,
    images: [`product-images/p${id}/a.webp`, `product-images/p${id}/b.webp`],
    variants: [
      { name: "Red", swatch: "#c00", availability: "in_stock", image: `product-images/p${id}/a.webp` },
      { name: "Blue", swatch: "#00c", availability: "out_of_stock", image: `product-images/p${id}/blue.webp` },
      { name: "Plain", swatch: "#eee", availability: "preorder", image: null },
    ],
    ...over,
  };
}

const summary = (...products: ProductSummary[]): CatalogSummary => ({
  gen: newGeneration(),
  categories: [{ id: "drinkware", name: "Drinkware", description: "", image: "product-images/c.webp" }],
  zones: [{ id: "inside-dhaka", name: "Inside Dhaka", charge: 80 }],
  sales: [],
  products,
});

describe("summary encoding", () => {
  test("round-trips, including offers, featured flags, availability and colours without pictures", () => {
    const doc = summary(product(1), product(2, { regularPrice: 150, featured: true, images: [] }));
    doc.products[1]!.variants[0]!.image = null;
    expect(decodeSummary(encodeSummary(doc))).toEqual(doc);
  });

  test("colour 0 shares the first card picture instead of storing it twice", () => {
    const json = encodeSummary(summary(product(1)));
    expect(json.split("product-images/p1/a.webp").length - 1).toBe(1);
  });

  test("rejects other versions, damaged rows and unknown availability", () => {
    const good = JSON.parse(encodeSummary(summary(product(1))));
    expect(() => decodeSummary(JSON.stringify({ ...good, v: 1 }))).toThrow();
    expect(() => decodeSummary(JSON.stringify({ ...good, products: [[1, "x"]] }))).toThrow();
    const unknown = structuredClone(good);
    unknown.products[0][10][0][2] = 9;
    expect(() => decodeSummary(JSON.stringify(unknown))).toThrow();
    expect(() => decodeSummary("not json")).toThrow();
  });

  test("detail documents check their shape", () => {
    const detail = { gen: "g", product: { id: 1, slug: "a", variants: [{}] } };
    expect(decodeDetail(encodeDetail(detail as never)).gen).toBe("g");
    expect(() =>
      decodeDetail(JSON.stringify({ v: 2, gen: "g", product: { id: 1, slug: "a", variants: [] } })),
    ).toThrow();
    expect(() => decodeDetail(JSON.stringify({ v: 1, gen: "g", product: detail.product }))).toThrow();
  });
});

describe("generations", () => {
  test("sort by time, and a detail is current unless older than the summary", () => {
    const older = newGeneration(new Date("2026-01-01T00:00:00Z"));
    const newer = newGeneration(new Date("2026-02-01T00:00:00Z"));
    expect(older < newer).toBe(true);
    expect(detailIsCurrent(newer, older)).toBe(true);
    expect(detailIsCurrent(newer, newer)).toBe(true);
    expect(detailIsCurrent(older, newer)).toBe(false);
    expect(newGeneration()).not.toBe(newGeneration());
  });

  test("builds in the same millisecond keep the order they were made in", () => {
    const now = new Date("2026-11-11T00:00:00.000Z");
    for (let i = 0; i < 200; i++) {
      const first = newGeneration(now);
      const second = newGeneration(now);
      expect(first < second).toBe(true);
      expect(detailIsCurrent(first, second)).toBe(false);
    }
  });
});

describe("patches", () => {
  test("a replaced product keeps its place; a new one goes in by sort, then id; null removes", () => {
    const doc = summary(product(1), product(2), product(3));
    expect(patchSummaryProduct(doc, 2, product(2, { name: "Renamed" })).products.map((p) => p.name)).toEqual([
      "Product 1",
      "Renamed",
      "Product 3",
    ]);
    expect(patchSummaryProduct(doc, 9, product(9, { sort: 15 })).products.map((p) => p.id)).toEqual([1, 9, 2, 3]);
    expect(patchSummaryProduct(doc, 9, product(9, { sort: 20 })).products.map((p) => p.id)).toEqual([1, 2, 9, 3]);
    expect(patchSummaryProduct(doc, 9, product(9, { sort: 99 })).products.map((p) => p.id)).toEqual([1, 2, 3, 9]);
    expect(patchSummaryProduct(doc, 1, product(1, { sort: 99 })).products.map((p) => p.id)).toEqual([2, 3, 1]);
    expect(patchSummaryProduct(doc, 2, null).products.map((p) => p.id)).toEqual([1, 3]);
    expect(doc.products.length).toBe(3); // the input is not changed
  });

  test("predecessorId", () => {
    const doc = summary(product(1), product(2));
    expect(predecessorId(doc, 2)).toBe(1);
    expect(predecessorId(doc, 1)).toBeNull();
    expect(predecessorId(doc, 7)).toBeNull();
  });

  test("the legacy list follows the summary's order, and refuses when the neighbour is missing", () => {
    const legacy = (id: number): Product => ({
      id,
      slug: `p-${id}`,
      name: `P${id}`,
      category: "c",
      price: 1,
      summary: "",
      variants: [] as never,
    });
    const catalog: Catalog = {
      categories: [],
      products: [legacy(1), legacy(2), legacy(3)],
      imageBase: "",
      deliveryZones: [],
    };
    expect(patchLegacyProduct(catalog, 9, legacy(9), 1)?.products.map((p) => p.id)).toEqual([1, 9, 2, 3]);
    expect(patchLegacyProduct(catalog, 9, legacy(9), null)?.products.map((p) => p.id)).toEqual([9, 1, 2, 3]);
    expect(patchLegacyProduct(catalog, 2, legacy(2), 1)?.products.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(patchLegacyProduct(catalog, 2, null, null)?.products.map((p) => p.id)).toEqual([1, 3]);
    expect(patchLegacyProduct(catalog, 9, legacy(9), 77)).toBeUndefined();
  });
});

describe("public shape", () => {
  test("resolves image keys to URLs and drops the sort value", () => {
    const card = resolveCard(product(1), "https://images.cavarabd.com");
    expect(card).not.toHaveProperty("sort");
    expect(card.images[0]).toBe("https://images.cavarabd.com/product-images/p1/a.webp");
    expect(card.variants[1]?.image).toBe("https://images.cavarabd.com/product-images/p1/blue.webp");
    expect(card.variants[2]?.image).toBeNull();
    expect(resolveCard(product(1), "").images[0]).toBe("/media/product-images/p1/a.webp");
  });

  test("summaryIndex is built once per summary", () => {
    const doc = summary(product(1), product(2));
    const index = summaryIndex(doc);
    expect(summaryIndex(doc)).toBe(index);
    expect(index.bySlug.get("p-2")?.id).toBe(2);
    expect(index.categoryById.get("drinkware")?.name).toBe("Drinkware");
  });
});

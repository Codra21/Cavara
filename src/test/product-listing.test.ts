import { describe, expect, test } from "bun:test";
import type { CatalogSummary, ProductSummary, SummaryVariant } from "@/domain/catalog-snapshot";
import {
  hasActiveFilters,
  LISTING_PAGE_SIZE,
  listProducts,
  normalizeQuery,
  offersChoice,
  parseListSearch,
  selectFeatured,
  selectNewest,
} from "@/domain/product-listing";
import type { Availability } from "@/lib/types";

const colour = (availability: Availability = "in_stock"): SummaryVariant => ({
  name: "Plain",
  swatch: "#fff",
  availability,
  image: null,
});

let nextId = 1;
function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  const id = overrides.id ?? nextId++;
  return {
    id,
    slug: `product-${id}`,
    name: `Product ${id}`,
    category: "cups",
    price: 500,
    regularPrice: null,
    featured: false,
    createdAt: "2026-01-01",
    sort: id,
    images: [],
    variants: [colour()],
    ...overrides,
  };
}

function summary(products: ProductSummary[]): CatalogSummary {
  return {
    gen: "g",
    zones: [],
    sales: [],
    categories: [
      { id: "cups", name: "Cups", description: "", image: "" },
      { id: "jars", name: "Storage Jars", description: "", image: "" },
      { id: "empty", name: "Nothing Here", description: "", image: "" },
    ],
    products,
  };
}

const names = (page: { items: ProductSummary[] }) => page.items.map((item) => item.name);

describe("listProducts sorting", () => {
  const data = summary([
    product({ id: 1, name: "Old", createdAt: "2026-01-01", price: 300 }),
    product({ id: 2, name: "New", createdAt: "2026-03-01", price: 100 }),
    product({ id: 3, name: "Pick old", featured: true, createdAt: "2026-01-05", price: 200 }),
    product({ id: 4, name: "Pick new", featured: true, createdAt: "2026-02-01", price: 400 }),
  ]);

  test("default order is featured first, then newest within each group", () => {
    expect(names(listProducts(data, {}))).toEqual(["Pick new", "Pick old", "New", "Old"]);
  });
  test("newest ignores featured", () => {
    expect(names(listProducts(data, { sort: "newest" }))).toEqual(["New", "Pick new", "Pick old", "Old"]);
  });
  test("price sorts run in price order", () => {
    expect(names(listProducts(data, { sort: "price-asc" }))).toEqual(["New", "Pick old", "Old", "Pick new"]);
    expect(names(listProducts(data, { sort: "price-desc" }))).toEqual(["Pick new", "Old", "Pick old", "New"]);
  });
  test("equal prices keep display order", () => {
    const same = summary([product({ id: 1, sort: 2 }), product({ id: 2, sort: 1 })]);
    expect(listProducts(same, { sort: "price-asc" }).items.map((item) => item.id)).toEqual([2, 1]);
  });
  test("products created the same day keep their display order", () => {
    const same = summary([product({ id: 1, sort: 2 }), product({ id: 2, sort: 1 })]);
    expect(listProducts(same, { sort: "newest" }).items.map((item) => item.id)).toEqual([2, 1]);
  });
});

describe("listProducts filters", () => {
  const data = summary([
    product({ id: 1, name: "Red Cup", category: "cups", price: 400 }),
    product({ id: 2, name: "Blue Cup", category: "cups", price: 900, variants: [colour("out_of_stock")] }),
    product({ id: 3, name: "Spice Jar", category: "jars", price: 1200, variants: [colour("preorder")] }),
    product({
      id: 4,
      name: "Mixed Jar",
      category: "jars",
      price: 700,
      variants: [colour("out_of_stock"), colour("in_stock")],
    }),
  ]);
  const ids = (query: Parameters<typeof listProducts>[1]) =>
    listProducts(data, { sort: "price-asc", ...query }).items.map((item) => item.id);

  test("category", () => expect(ids({ category: "jars" })).toEqual([4, 3]));
  test("price range is inclusive on both ends", () => {
    expect(ids({ min: 700, max: 1200 })).toEqual([4, 2, 3]);
    expect(ids({ min: 901 })).toEqual([3]);
    expect(ids({ max: 399 })).toEqual([]);
  });
  test("in stock needs one colour in stock", () => expect(ids({ availability: "in-stock" })).toEqual([1, 4]));
  test("pre-order needs one pre-order colour", () => expect(ids({ availability: "preorder" })).toEqual([3]));
  test("without an availability filter, sold out products are listed", () => expect(ids({})).toContain(2));
  test("search matches every word against name or category name, in any case", () => {
    expect(ids({ q: "cup" })).toEqual([1, 2]);
    expect(ids({ q: "STORAGE jar" })).toEqual([4, 3]);
    expect(ids({ q: "spice cup" })).toEqual([]);
    expect(ids({ q: "  red   cups " })).toEqual([1]);
  });
  test("filters combine", () => expect(ids({ category: "jars", availability: "in-stock", max: 800 })).toEqual([4]));
});

describe("listProducts paging", () => {
  const many = summary(Array.from({ length: 50 }, () => product()));

  test("pages hold 24 products", () => {
    const first = listProducts(many, {});
    expect(first.items).toHaveLength(LISTING_PAGE_SIZE);
    expect([first.total, first.page, first.pageCount, first.pageSize]).toEqual([50, 1, 3, 24]);
    expect(listProducts(many, { page: 3 }).items).toHaveLength(2);
  });
  test("pages do not overlap", () => {
    const seen = [1, 2, 3].flatMap((page) => listProducts(many, { page }).items.map((item) => item.id));
    expect(new Set(seen).size).toBe(50);
  });
  test("a page past the end is empty and reports the real page count", () => {
    const past = listProducts(many, { page: 9 });
    expect(past.items).toEqual([]);
    expect(past.pageCount).toBe(3);
  });
  test("no results still has one page", () => {
    expect(listProducts(summary([]), {}).pageCount).toBe(1);
  });
});

describe("facets", () => {
  const data = summary([
    product({ id: 1, category: "cups", price: 400 }),
    product({ id: 2, category: "cups", price: 900, variants: [colour("out_of_stock")] }),
    product({ id: 3, category: "jars", price: 1200, variants: [colour("preorder")] }),
  ]);

  test("category counts ignore the category filter but respect the others", () => {
    const facets = listProducts(data, { category: "jars", max: 1000 }).facets;
    expect(facets.categories).toEqual([
      { id: "cups", name: "Cups", count: 2 },
      { id: "jars", name: "Storage Jars", count: 0 },
    ]);
  });
  test("categories without any published product are not offered", () => {
    expect(listProducts(data, {}).facets.categories.map((item) => item.id)).toEqual(["cups", "jars"]);
  });
  test("the price range ignores the price filter", () => {
    expect(listProducts(data, { min: 1000 }).facets.price).toEqual({ min: 400, max: 1200 });
    expect(listProducts(data, { category: "jars" }).facets.price).toEqual({ min: 1200, max: 1200 });
    expect(listProducts(data, { q: "nothing matches" }).facets.price).toBeNull();
  });
  test("availability counts ignore the availability filter", () => {
    expect(listProducts(data, { availability: "preorder" }).facets.availability).toEqual({
      all: 3,
      inStock: 1,
      preorder: 1,
      soldOut: 1,
    });
  });
  test("offersChoice is true only when an option differs from the full list", () => {
    expect(offersChoice([3, 0], 3)).toBe(false);
    expect(offersChoice([3], 3)).toBe(false);
    expect(offersChoice([1, 0], 3)).toBe(true);
  });
});

describe("home rows", () => {
  const data = [
    product({ id: 1, featured: true, createdAt: "2026-01-01", sort: 1 }),
    product({ id: 2, featured: false, createdAt: "2026-03-01", sort: 2 }),
    product({ id: 3, featured: true, createdAt: "2026-02-01", sort: 3 }),
  ];
  test("featured keeps display order and stops at the limit", () => {
    expect(selectFeatured(data).map((item) => item.id)).toEqual([1, 3]);
    expect(selectFeatured(data, 1).map((item) => item.id)).toEqual([1]);
  });
  test("new arrivals are the newest first, whatever their flag", () => {
    expect(selectNewest(data).map((item) => item.id)).toEqual([2, 3, 1]);
    expect(data.map((item) => item.id)).toEqual([1, 2, 3]);
  });
  test("both rows hold eight cards at most", () => {
    const lots = Array.from({ length: 20 }, () => product({ featured: true }));
    expect(selectFeatured(lots)).toHaveLength(8);
    expect(selectNewest(lots)).toHaveLength(8);
  });
});

describe("parseListSearch", () => {
  test("keeps valid values", () => {
    expect(
      parseListSearch({ q: " red  cup ", sort: "newest", min: 100, max: "900", availability: "preorder", page: 3 }),
    ).toEqual({ q: "red cup", sort: "newest", min: 100, max: 900, availability: "preorder", page: 3 });
  });
  test("drops invalid values and defaults", () => {
    expect(parseListSearch({ q: "  ", sort: "featured", min: -5, max: 1.5, availability: "gone", page: 1 })).toEqual(
      {},
    );
    expect(parseListSearch({ sort: "random", min: "abc", page: "x", q: { a: 1 } })).toEqual({});
    expect(parseListSearch({ page: 1001, max: 10_000_001 })).toEqual({});
  });
  test("a bare number in q is text (the router parses ?q=2 as a number)", () => {
    expect(parseListSearch({ q: 2 })).toEqual({ q: "2" });
  });
  test("long search text is cut to 80 characters", () => {
    expect(parseListSearch({ q: "a".repeat(200) }).q).toHaveLength(80);
  });
  test("hasActiveFilters ignores sort and page", () => {
    expect(hasActiveFilters({ sort: "newest", page: 2 })).toBe(false);
    expect(hasActiveFilters({ min: 0 })).toBe(true);
  });
  test("normalizeQuery drops defaults so equal lists share a cache key", () => {
    expect(normalizeQuery({ category: "", q: "", sort: "featured", page: 1 })).toEqual({});
    expect(normalizeQuery({ category: "cups", page: 2, sort: "newest" })).toEqual({
      category: "cups",
      sort: "newest",
      page: 2,
    });
  });
});

describe("new arrivals checkbox rule (C2.5)", () => {
  test("ticked new_arrival products come first (newest first) and remaining slots fill with newest", () => {
    const base = {
      slug: "p",
      name: "Piece",
      category: "drinkware",
      price: 1000,
      regularPrice: null,
      featured: false,
      sort: 1,
      images: ["a.webp"],
      variants: [{ name: "White", swatch: "#fff", availability: "in_stock" as const, image: "a.webp" }],
    };
    const items = [
      { ...base, id: 1, createdAt: "2026-01-01", newArrival: true },
      { ...base, id: 2, createdAt: "2026-05-01", newArrival: false },
      { ...base, id: 3, createdAt: "2026-03-01", newArrival: true },
      { ...base, id: 4, createdAt: "2026-04-01", newArrival: false },
    ];
    expect(selectNewest(items, 3).map((item) => item.id)).toEqual([3, 1, 2]);
  });
});

describe("sold-out filter (C2.8)", () => {
  test("sold-out filter matches products where all colours are out_of_stock", () => {
    const base = {
      slug: "p",
      name: "Piece",
      category: "drinkware",
      price: 1000,
      regularPrice: null,
      featured: false,
      createdAt: "2026-01-01",
      sort: 1,
      images: ["a.webp"],
    };
    const summary = {
      gen: "g",
      categories: [{ id: "drinkware", name: "Drinkware", description: "", image: "" }],
      zones: [],
      sales: [],
      products: [
        { ...base, id: 1, variants: [{ name: "A", swatch: "#fff", availability: "in_stock" as const, image: null }] },
        {
          ...base,
          id: 2,
          variants: [{ name: "B", swatch: "#000", availability: "out_of_stock" as const, image: null }],
        },
      ],
    };
    const page = listProducts(summary, { availability: "sold-out" });
    expect(page.items.map((item) => item.id)).toEqual([2]);
    expect(page.facets.availability.soldOut).toBe(1);
  });
});

describe("parent category facets and unique total (C6)", () => {
  const hierarchical: CatalogSummary = {
    gen: "g",
    zones: [],
    sales: [],
    categories: [
      { id: "drinkware", name: "Drinkware", description: "", image: "", parentId: null },
      { id: "mugs", name: "Mugs", description: "", image: "", parentId: "drinkware" },
      { id: "tumblers", name: "Tumblers", description: "", image: "", parentId: "drinkware" },
      { id: "plates", name: "Plates", description: "", image: "", parentId: null },
      { id: "empty-parent", name: "Empty Parent", description: "", image: "", parentId: null },
    ],
    products: [
      product({ id: 101, name: "Clay Mug", category: "mugs", price: 450 }),
      product({ id: 102, name: "Tall Mug", category: "mugs", price: 950 }),
      product({ id: 103, name: "Glazed Tumbler", category: "tumblers", price: 600 }),
      product({ id: 104, name: "Dinner Plate", category: "plates", price: 500 }),
    ],
  };

  test("parent category appears in facets.categories with rolled-up subcategory counts and facets.total does not double-count", () => {
    const all = listProducts(hierarchical, {});
    expect(all.facets.categories).toEqual([
      { id: "drinkware", name: "Drinkware", count: 3 },
      { id: "mugs", name: "Mugs", count: 2 },
      { id: "tumblers", name: "Tumblers", count: 1 },
      { id: "plates", name: "Plates", count: 1 },
    ]);
    expect(all.facets.total).toBe(4);
    expect(listProducts(hierarchical, { category: "drinkware" }).total).toBe(3);
  });

  test("parent category counts and facets.total respect other filters and ignore active category filter", () => {
    const filtered = listProducts(hierarchical, { category: "mugs", max: 600 });
    expect(filtered.total).toBe(1);
    expect(filtered.facets.categories).toEqual([
      { id: "drinkware", name: "Drinkware", count: 2 },
      { id: "mugs", name: "Mugs", count: 1 },
      { id: "tumblers", name: "Tumblers", count: 1 },
      { id: "plates", name: "Plates", count: 1 },
    ]);
    expect(filtered.facets.total).toBe(3);
  });

  test("parent category with both direct and subcategory products sums both without double-counting facets.total", () => {
    const mixed: CatalogSummary = {
      ...hierarchical,
      products: [...hierarchical.products, product({ id: 105, name: "Carafe", category: "drinkware", price: 1100 })],
    };
    const all = listProducts(mixed, {});
    expect(all.facets.categories.find((c) => c.id === "drinkware")?.count).toBe(4);
    expect(all.facets.categories.find((c) => c.id === "mugs")?.count).toBe(2);
    expect(all.facets.total).toBe(5);
  });
});

import { lowStockLabel, maxQtyForStock } from "@/domain/bag";
import { describe, expect, test } from "bun:test";
import {
  addBagLine,
  availabilityTag,
  BAG_FULL_MESSAGE,
  bagOrderMessage,
  bagSubtotal,
  blockedLines,
  canCheckout,
  MAX_BAG_LINES,
  normalizeBag,
  resolveBagLines,
} from "@/domain/bag";
import type { ProductCard } from "@/domain/catalog-snapshot";

function card(id: number, price: number, availability: Array<"in_stock" | "out_of_stock" | "preorder"> = ["in_stock"]) {
  return {
    id,
    slug: `product-${id}`,
    name: `Product ${id}`,
    category: "drinkware",
    price,
    regularPrice: null,
    featured: false,
    createdAt: "2026-01-01",
    images: [`img-${id}.webp`],
    variants: availability.map((state, index) => ({
      name: `Colour ${index}`,
      swatch: "#fff",
      availability: state,
      image: `img-${id}-${index}.webp`,
    })),
  } satisfies ProductCard;
}

describe("normalizeBag", () => {
  test("keeps valid lines and clamps the quantity to 1..20", () => {
    expect(
      normalizeBag([
        { id: 3, variant: 1, qty: 2 },
        { id: 4, variant: 0, qty: 99 },
        { id: 5, variant: 0, qty: 0 },
        { id: 6, variant: 0 },
      ]),
    ).toEqual([
      { id: 3, variant: 1, qty: 2 },
      { id: 4, variant: 0, qty: 20 },
      { id: 5, variant: 0, qty: 1 },
      { id: 6, variant: 0, qty: 1 },
    ]);
  });

  test("drops malformed entries but does not judge whether the product exists", () => {
    expect(
      normalizeBag([
        null,
        "x",
        { id: "abc", variant: 0, qty: 1 },
        { id: 1.5, variant: 0, qty: 1 },
        { id: -2, variant: 0, qty: 1 },
        { id: 7, variant: -1, qty: 1 },
        { id: 7, variant: 0.5, qty: 1 },
        { id: 7, variant: 51, qty: 1 },
        { id: 999_999, variant: 0, qty: 1 },
      ]),
    ).toEqual([{ id: 999_999, variant: 0, qty: 1 }]);
    expect(normalizeBag("nope")).toEqual([]);
    expect(normalizeBag({ id: 1 })).toEqual([]);
  });

  test("merges duplicate lines and caps the number of lines at what an order can hold", () => {
    expect(
      normalizeBag([
        { id: 1, variant: 0, qty: 3 },
        { id: 1, variant: 0, qty: 25 },
      ]),
    ).toEqual([{ id: 1, variant: 0, qty: 20 }]);
    const many = Array.from({ length: MAX_BAG_LINES + 10 }, (_, index) => ({ id: index + 1, variant: 0, qty: 1 }));
    expect(normalizeBag(many)).toHaveLength(MAX_BAG_LINES);
  });
});

describe("addBagLine", () => {
  const fullBag = () => Array.from({ length: MAX_BAG_LINES }, (_, index) => ({ id: index + 1, variant: 0, qty: 1 }));

  test("a new colour becomes a new line", () => {
    expect(addBagLine([{ id: 1, variant: 0, qty: 1 }], 2, 1, 3)).toEqual({
      bag: [
        { id: 1, variant: 0, qty: 1 },
        { id: 2, variant: 1, qty: 3 },
      ],
      added: true,
    });
  });

  test("a colour already in the bag gains quantity, capped at 20", () => {
    expect(addBagLine([{ id: 1, variant: 0, qty: 18 }], 1, 0, 1).bag).toEqual([{ id: 1, variant: 0, qty: 19 }]);
    expect(addBagLine([{ id: 1, variant: 0, qty: 18 }], 1, 0, 5).bag).toEqual([{ id: 1, variant: 0, qty: 20 }]);
  });

  test("the 31st line is refused and the bag is returned unchanged", () => {
    const bag = fullBag();
    const result = addBagLine(bag, 999, 0, 1);
    expect(result.added).toBe(false);
    expect(result.bag).toBe(bag);
  });

  test("a full bag still takes more of a colour it already holds", () => {
    const result = addBagLine(fullBag(), 5, 0, 2);
    expect(result.added).toBe(true);
    expect(result.bag).toHaveLength(MAX_BAG_LINES);
    expect(result.bag.find((item) => item.id === 5)?.qty).toBe(3);
  });

  test("the same product in another colour is a new line, so it is refused in a full bag", () => {
    expect(addBagLine(fullBag(), 5, 1, 1).added).toBe(false);
  });

  test("the full-bag message names the limit", () => {
    expect(BAG_FULL_MESSAGE).toContain(String(MAX_BAG_LINES));
  });
});

describe("resolveBagLines", () => {
  const items = [
    { id: 1, variant: 0, qty: 2 },
    { id: 2, variant: 1, qty: 1 },
    { id: 3, variant: 0, qty: 1 },
  ];

  test("every line is pending until the lookup answers", () => {
    expect(resolveBagLines(items, undefined).map((line) => line.status)).toEqual(["pending", "pending", "pending"]);
    expect(canCheckout(resolveBagLines(items, undefined))).toBe(false);
  });

  test("a product in `missing` is unavailable and blocks checkout", () => {
    const lines = resolveBagLines(items, {
      products: [card(1, 500), card(2, 300, ["in_stock", "in_stock"])],
      missing: [3],
    });
    expect(lines.map((line) => line.status)).toEqual(["ok", "ok", "unavailable"]);
    expect(canCheckout(lines)).toBe(false);
    expect(blockedLines(lines)).toHaveLength(1);
    expect(bagSubtotal(lines)).toBe(500 * 2 + 300);
  });

  test("a colour that no longer exists is unavailable but keeps the product for display", () => {
    const [line] = resolveBagLines([{ id: 2, variant: 4, qty: 1 }], { products: [card(2, 300)], missing: [] });
    expect(line).toMatchObject({ status: "unavailable", product: { id: 2 } });
  });

  test("sold-out and pre-order colours are blocked and add nothing to the subtotal", () => {
    const lines = resolveBagLines(
      [
        { id: 1, variant: 0, qty: 1 },
        { id: 1, variant: 1, qty: 1 },
        { id: 1, variant: 2, qty: 3 },
      ],
      { products: [card(1, 100, ["in_stock", "out_of_stock", "preorder"])], missing: [] },
    );
    expect(lines.map((line) => line.status)).toEqual(["ok", "out_of_stock", "unavailable"]);
    expect(bagSubtotal(lines)).toBe(100);
    expect(canCheckout(lines)).toBe(false);
  });

  test("an id found in neither list is pending, as with an answer kept from an earlier set of ids", () => {
    const lines = resolveBagLines(items, { products: [card(1, 500)], missing: [] });
    expect(lines.map((line) => line.status)).toEqual(["ok", "pending", "pending"]);
    expect(canCheckout(lines)).toBe(false);
  });

  test("an empty bag cannot be checked out and a fully buyable one can", () => {
    expect(canCheckout([])).toBe(false);
    const lines = resolveBagLines([{ id: 1, variant: 0, qty: 1 }], { products: [card(1, 100)], missing: [] });
    expect(canCheckout(lines)).toBe(true);
  });
});

describe("bag text", () => {
  test("the order message lists only buyable lines and prices only them", () => {
    const lines = resolveBagLines(
      [
        { id: 1, variant: 0, qty: 2 },
        { id: 9, variant: 0, qty: 1 },
        { id: 1, variant: 1, qty: 1 },
      ],
      { products: [card(1, 250, ["in_stock", "out_of_stock"])], missing: [9] },
    );
    const message = bagOrderMessage(lines);
    expect(message).toContain("1. Product 1 — Color: Colour 0 — Qty: 2 — ৳ 500");
    expect(message).not.toContain("2. ");
    expect(message).toContain("Subtotal: ৳ 500");
  });

  test("availabilityTag names only out-of-stock colours", () => {
    expect(availabilityTag("out_of_stock")).toBe("Sold out");
    expect(availabilityTag("in_stock")).toBeNull();
    expect(availabilityTag("preorder")).toBe("Pre-order");
    expect(availabilityTag(undefined)).toBeNull();
  });
});

describe("stock limits and low stock label (C2.4)", () => {
  test("uncounted stock keeps MAX_QTY (20); counted stock caps quantity and shows Only N left at <= 3", () => {
    expect(maxQtyForStock(null)).toBe(20);
    expect(maxQtyForStock(undefined)).toBe(20);
    expect(maxQtyForStock(50)).toBe(20);
    expect(maxQtyForStock(3)).toBe(3);
    expect(lowStockLabel(null)).toBeNull();
    expect(lowStockLabel(4)).toBeNull();
    expect(lowStockLabel(3)).toBe("Only 3 left");
    expect(lowStockLabel(1)).toBe("Only 1 left");
    expect(lowStockLabel(0)).toBeNull();

    const first = addBagLine([], 1, 0, 5, 2);
    expect(first.bag).toEqual([{ id: 1, variant: 0, qty: 2 }]);
    const second = addBagLine(first.bag, 1, 0, 1, 2);
    expect(second.bag).toEqual([{ id: 1, variant: 0, qty: 2 }]);
  });
});

describe("stock caps on saved lines (review fix)", () => {
  test("a saved quantity above the stock resolves to the stock, and the subtotal uses it", () => {
    const base = card(1, 100);
    const product = { ...base, variants: [{ ...base.variants[0]!, stock: 2 }] } as ProductCard;
    const lines = resolveBagLines([{ id: 1, variant: 0, qty: 8 }], { products: [product], missing: [] });
    expect(lines[0]).toMatchObject({ status: "ok", item: { qty: 2 } });
    expect(bagSubtotal(lines)).toBe(200);
  });

  test("adding to a line above the cap brings it down to the cap", () => {
    const { bag } = addBagLine([{ id: 1, variant: 0, qty: 8 }], 1, 0, 1, 2);
    expect(bag).toEqual([{ id: 1, variant: 0, qty: 2 }]);
  });
});

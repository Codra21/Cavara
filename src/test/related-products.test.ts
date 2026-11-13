import { describe, expect, test } from "bun:test";
import { RELATED_LIMIT, selectRelated } from "@/domain/related-products";

const product = (id: number, category: string) => ({ id, category });
const ids = (list: { id: number }[]) => list.map((item) => item.id);

// Display order: 1 a, 2 b, 3 a, 4 a, 5 b, 6 a, 7 a, 8 c
const list = [
  product(1, "a"),
  product(2, "b"),
  product(3, "a"),
  product(4, "a"),
  product(5, "b"),
  product(6, "a"),
  product(7, "a"),
  product(8, "c"),
];

describe("selectRelated", () => {
  test("returns at most four, never the product itself", () => {
    const related = selectRelated(list, product(1, "a"));
    expect(related).toHaveLength(RELATED_LIMIT);
    expect(ids(related)).not.toContain(1);
  });

  test("starts with the same category, rotated to begin after the current product", () => {
    expect(ids(selectRelated(list, product(3, "a")))).toEqual([4, 6, 7, 1]);
    expect(ids(selectRelated(list, product(6, "a")))).toEqual([7, 1, 3, 4]);
  });

  test("tops up from other categories when the category is too small, in display order after the product", () => {
    expect(ids(selectRelated(list, product(2, "b")))).toEqual([5, 3, 4, 6]);
    expect(ids(selectRelated(list, product(8, "c")))).toEqual([1, 2, 3, 4]);
  });

  test("a small catalogue returns what exists", () => {
    expect(selectRelated([product(1, "a")], product(1, "a"))).toEqual([]);
    expect(ids(selectRelated([product(1, "a"), product(2, "a")], product(1, "a")))).toEqual([2]);
  });

  test("the answer depends only on the list and the product, so it caches", () => {
    expect(selectRelated(list, product(3, "a"))).toEqual(selectRelated([...list], product(3, "a")));
  });

  test("an id missing from the list falls back to display order", () => {
    expect(ids(selectRelated(list, product(99, "b")))).toEqual([2, 5, 1, 3]);
  });

  test("a bigger limit is honoured", () => {
    expect(selectRelated(list, product(1, "a"), 8)).toHaveLength(7);
  });
});

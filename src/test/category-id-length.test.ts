import { describe, expect, test } from "bun:test";
import { bulkProductActionSchema } from "@/domain/admin-product-actions";
import { adminProductCountsSchema, adminProductListSchema } from "@/domain/admin-product-list";
import { categoryInputSchema } from "@/domain/categories-admin";
import { discountInputSchema } from "@/domain/discounts";
import { productInputSchema } from "@/domain/product-admin";

const ID_50 = "a".repeat(50);
const ID_64 = "a".repeat(64);
const ID_65 = "a".repeat(65);

function makeCategory(slug: string) {
  return {
    id: slug,
    name: "Long Category",
    slug,
    description: "",
    image: "",
    parentId: null,
    sort: 0,
    active: true,
  };
}

function makeProduct(categoryId: string) {
  return {
    name: "Ceramic Mug",
    slug: "ceramic-mug",
    categoryId,
    summary: "",
    details: [],
    note: "",
    price: 500,
    regularPrice: null,
    costPrice: null,
    weightG: null,
    status: "draft" as const,
    featured: false,
    newArrival: false,
    sort: 0,
    variants: [],
  };
}

function makeDiscount(categoryId: string) {
  return {
    name: "Category Sale",
    scope: "category" as const,
    categoryId,
    productId: null,
    type: "percent" as const,
    value: 15,
    startsAt: "2026-11-01T00:00:00.000Z",
    endsAt: null,
    active: true,
  };
}

describe("categoryId max length alignment across admin schemas (C4B-10)", () => {
  test("accepts 50-char and 64-char categoryIds across all admin schemas", () => {
    for (const id of [ID_50, ID_64]) {
      expect(categoryInputSchema.safeParse(makeCategory(id)).success).toBe(true);
      expect(productInputSchema.safeParse(makeProduct(id)).success).toBe(true);
      expect(bulkProductActionSchema.safeParse({ action: "set_category", ids: [1], categoryId: id }).success).toBe(
        true,
      );
      expect(discountInputSchema.safeParse(makeDiscount(id)).success).toBe(true);
      expect(adminProductListSchema.safeParse({ category: id }).success).toBe(true);
      expect(adminProductCountsSchema.safeParse({ category: id }).success).toBe(true);
    }
  });

  test("rejects 65-char categoryIds across all admin schemas", () => {
    expect(categoryInputSchema.safeParse(makeCategory(ID_65)).success).toBe(false);
    expect(productInputSchema.safeParse(makeProduct(ID_65)).success).toBe(false);
    expect(bulkProductActionSchema.safeParse({ action: "set_category", ids: [1], categoryId: ID_65 }).success).toBe(
      false,
    );
    expect(discountInputSchema.safeParse(makeDiscount(ID_65)).success).toBe(false);
    expect(adminProductListSchema.safeParse({ category: ID_65 }).success).toBe(false);
    expect(adminProductCountsSchema.safeParse({ category: ID_65 }).success).toBe(false);
  });
});

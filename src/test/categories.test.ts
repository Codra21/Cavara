import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { validateCategoryParent } from "@/domain/categories-admin";
import { selectRelated } from "@/domain/related-products";
import { listProductsPage } from "@/server/catalog-queries.server";
import { listManagedCategories, saveCategory } from "@/server/db/admin-categories.repository";
import { createTestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };

describe("related products order with subcategories and sold-out last (C2.6)", () => {
  const categories = [
    { id: "drinkware", parentId: null },
    { id: "mugs", parentId: "drinkware" },
    { id: "glasses", parentId: "drinkware" },
    { id: "serveware", parentId: null },
  ];

  const make = (id: number, category: string, availability: "in_stock" | "out_of_stock" = "in_stock") => ({
    id,
    category,
    variants: [{ name: "Default", swatch: "#fff", availability, image: null }],
  });

  test("orders same subcategory first, then same top-level category, then others, with sold-out last", () => {
    const products = [
      make(1, "mugs"), // current
      make(2, "serveware"),
      make(3, "mugs", "out_of_stock"), // sold-out in same subcategory -> goes last!
      make(4, "glasses"), // sibling in drinkware
      make(5, "mugs"), // available in same subcategory
      make(6, "drinkware"), // parent category
    ];
    const related = selectRelated(products, products[0]!, 5, categories);
    expect(related.map((p) => p.id)).toEqual([5, 4, 6, 2, 3]);
  });
});

describe("category manager, two-level hierarchy, and 301 slug redirects (C2.6)", () => {
  test("validates two-level nesting limit", () => {
    const existing = [
      { id: "drinkware", parentId: null },
      { id: "mugs", parentId: "drinkware" },
    ];
    expect(validateCategoryParent("cups", "mugs", existing)).toContain("two levels");
    expect(validateCategoryParent("drinkware", "drinkware", existing)).toContain("own parent");
    expect(validateCategoryParent("drinkware", "serveware", [...existing, { id: "serveware", parentId: null }])).toContain(
      "subcategories",
    );
  });

  test("creating a subcategory and renaming a slug records a 301 redirect in category_slugs", async () => {
    const db = createTestD1();
    const created = await saveCategory(db, owner, {
      id: null,
      name: "Ceramic Mugs",
      slug: "ceramic-mugs",
      description: "Hand-painted mugs",
      image: "",
      parentId: "drinkware",
      sort: 10,
      active: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.category.id).toBe("ceramic-mugs");
    expect(created.category.parentId).toBe("drinkware");

    // Rename URL slug; stable id stays "ceramic-mugs" and old slug is recorded for 301 redirect.
    const renamed = await saveCategory(db, owner, {
      id: "ceramic-mugs",
      name: "Handcrafted Mugs",
      slug: "handcrafted-mugs",
      description: "Hand-painted mugs",
      image: "",
      parentId: "drinkware",
      sort: 10,
      active: true,
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.category.oldSlugs).toEqual(["ceramic-mugs"]);

    const listing = await listProductsPage({ imageBase: "", db: () => db }, { category: "ceramic-mugs" });
    expect(listing.redirectTo).toBe("/collections/drinkware/handcrafted-mugs");

    const all = await listManagedCategories(db);
    expect(all.some((cat) => cat.id === "ceramic-mugs" && cat.slug === "handcrafted-mugs")).toBe(true);
  });
});

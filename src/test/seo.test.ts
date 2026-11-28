import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  canonicalRedirect,
  collectionUrl,
  listingSeo,
  metaDescription,
  productAvailability,
  productJsonLd,
  sitemapXml,
} from "@/domain/seo";
import type { Category, Product } from "@/lib/types";
import { invalidateCatalogCache } from "@/server/catalog-cache.server";
import { getProductBySlug } from "@/server/catalog-queries.server";
import { saveCategory } from "@/server/db/admin-categories.repository";
import { createTestD1 } from "./helpers/d1";

const SITE = "https://cavarabd.com";
const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const category: Category = { id: "drinkware", name: "Drinkware", description: "", image: "" };
const product: Product = {
  id: 7,
  slug: "red-polka-cup",
  name: "Red Polka Cup & Plate",
  category: "drinkware",
  price: 1550,
  summary: "A cup and plate for slow mornings.",
  variants: [
    {
      name: "Off-white",
      swatch: "#fff",
      images: [
        "https://images.cavarabd.com/product-images/a.webp",
        "https://images.cavarabd.com/product-images/b.webp",
      ],
      availability: "out_of_stock",
    },
    {
      name: "Red",
      swatch: "#c00",
      images: ["https://images.cavarabd.com/product-images/a.webp"],
      availability: "preorder",
    },
  ],
};

describe("absoluteUrl", () => {
  test("keeps absolute image URLs (the live og:image bug: https://cavarabd.comhttps://images…)", () => {
    expect(absoluteUrl(SITE, "https://images.cavarabd.com/x.webp")).toBe("https://images.cavarabd.com/x.webp");
  });
  test("prefixes and encodes site paths", () => {
    expect(absoluteUrl(SITE, "/media/product-images/a b.webp")).toBe(
      "https://cavarabd.com/media/product-images/a%20b.webp",
    );
    expect(absoluteUrl(`${SITE}/`, "og-image.jpg")).toBe("https://cavarabd.com/og-image.jpg");
  });
});

describe("product structured data", () => {
  test("Product with a BDT offer, availability, unique absolute images and category", () => {
    const ld = productJsonLd(product, category, SITE);
    expect(ld).toMatchObject({
      "@type": "Product",
      name: "Red Polka Cup & Plate",
      url: "https://cavarabd.com/products/red-polka-cup",
      sku: "7",
      category: "Drinkware",
      offers: {
        "@type": "Offer",
        price: 1550,
        priceCurrency: "BDT",
        availability: "https://schema.org/PreOrder",
        itemCondition: "https://schema.org/NewCondition",
      },
    });
    expect(ld.image).toEqual([
      "https://images.cavarabd.com/product-images/a.webp",
      "https://images.cavarabd.com/product-images/b.webp",
    ]);
  });

  test("availability: any in stock wins, then pre-order, else out of stock", () => {
    expect(productAvailability(product)).toBe("preorder");
    expect(productAvailability({ ...product, variants: [{ ...product.variants[0]!, availability: undefined }] })).toBe(
      "in_stock",
    );
    expect(productAvailability({ ...product, variants: [product.variants[0]!] })).toBe("out_of_stock");
  });

  test("BreadcrumbList: Home › category › product", () => {
    const ld = breadcrumbJsonLd(product, category, SITE);
    expect(ld.itemListElement.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, "Home", "https://cavarabd.com/"],
      [2, "Drinkware", "https://cavarabd.com/collections/drinkware"],
      [3, "Red Polka Cup & Plate", "https://cavarabd.com/products/red-polka-cup"],
    ]);
  });

  test("BreadcrumbList falls back to categorySlug when category.path is omitted on a renamed category", () => {
    const renamed: Category = {
      id: "drinkware",
      slug: "cups-and-mugs",
      name: "Cups & Mugs",
      description: "",
      image: "",
    };
    const ld = breadcrumbJsonLd(product, renamed, SITE);
    expect(ld.itemListElement.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, "Home", "https://cavarabd.com/"],
      [2, "Cups & Mugs", "https://cavarabd.com/collections/cups-and-mugs"],
      [3, "Red Polka Cup & Plate", "https://cavarabd.com/products/red-polka-cup"],
    ]);
  });

  test("BreadcrumbList emits Home › Parent › Subcategory › Product when parentCategory is present", () => {
    const parent: Category = {
      id: "drinkware",
      slug: "cups-and-mugs",
      name: "Cups & Mugs",
      description: "",
      image: "",
      path: "/collections/cups-and-mugs",
    };
    const sub: Category = {
      id: "ceramic-mugs",
      slug: "handcrafted-mugs",
      parentId: "drinkware",
      name: "Handcrafted Mugs",
      description: "",
      image: "",
      path: "/collections/cups-and-mugs/handcrafted-mugs",
    };
    const ld = breadcrumbJsonLd(product, sub, SITE, parent);
    expect(ld.itemListElement.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, "Home", "https://cavarabd.com/"],
      [2, "Cups & Mugs", "https://cavarabd.com/collections/cups-and-mugs"],
      [3, "Handcrafted Mugs", "https://cavarabd.com/collections/cups-and-mugs/handcrafted-mugs"],
      [4, "Red Polka Cup & Plate", "https://cavarabd.com/products/red-polka-cup"],
    ]);

    // Also works when .path is omitted on both parent and subcategory
    const { path: _parentPath, ...parentNoPath } = parent;
    const { path: _subPath, ...subNoPath } = sub;
    const ldNoPath = breadcrumbJsonLd(product, subNoPath, SITE, parentNoPath);
    expect(ldNoPath.itemListElement.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, "Home", "https://cavarabd.com/"],
      [2, "Cups & Mugs", "https://cavarabd.com/collections/cups-and-mugs"],
      [3, "Handcrafted Mugs", "https://cavarabd.com/collections/cups-and-mugs/handcrafted-mugs"],
      [4, "Red Polka Cup & Plate", "https://cavarabd.com/products/red-polka-cup"],
    ]);
  });

  test("getProductBySlug returns parentCategory for subcategory products and null for top-level products", async () => {
    const db = createTestD1();
    const renamedParent = await saveCategory(db, owner, {
      id: "drinkware",
      name: "Drinkware",
      slug: "cups-and-mugs",
      description: "Cups and mugs",
      image: "",
      parentId: null,
      sort: 1,
      active: true,
    });
    expect(renamedParent.ok).toBe(true);

    const createdSub = await saveCategory(db, owner, {
      id: null,
      name: "Ceramic Mugs",
      slug: "ceramic-mugs",
      description: "Hand-painted mugs",
      image: "",
      parentId: "drinkware",
      sort: 10,
      active: true,
    });
    expect(createdSub.ok).toBe(true);
    if (!createdSub.ok) return;

    const renamedSub = await saveCategory(db, owner, {
      id: createdSub.category.id,
      name: "Handcrafted Mugs",
      slug: "handcrafted-mugs",
      description: "Hand-painted mugs",
      image: "",
      parentId: "drinkware",
      sort: 10,
      active: true,
    });
    expect(renamedSub.ok).toBe(true);

    // Move one product into the subcategory while leaving another in the top-level category.
    await db
      .prepare("UPDATE products SET category_id = ? WHERE slug = ?")
      .bind(createdSub.category.id, "red-polka-bow-cup-bread-plate")
      .run();

    await invalidateCatalogCache("");
    const subPage = await getProductBySlug(
      { imageBase: "https://images.cavarabd.com", db: () => db },
      "red-polka-bow-cup-bread-plate",
    );
    expect(subPage.product).not.toBeNull();
    expect(subPage.category?.id).toBe("ceramic-mugs");
    expect(subPage.category?.path).toBe("/collections/cups-and-mugs/handcrafted-mugs");
    expect(subPage.parentCategory?.id).toBe("drinkware");
    expect(subPage.parentCategory?.path).toBe("/collections/cups-and-mugs");

    const ld = breadcrumbJsonLd(
      subPage.product!,
      subPage.category ?? undefined,
      SITE,
      subPage.parentCategory ?? undefined,
    );
    expect(ld.itemListElement.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, "Home", "https://cavarabd.com/"],
      [2, "Drinkware", "https://cavarabd.com/collections/cups-and-mugs"],
      [3, "Handcrafted Mugs", "https://cavarabd.com/collections/cups-and-mugs/handcrafted-mugs"],
      [4, subPage.product!.name, `https://cavarabd.com/products/${subPage.product!.slug}`],
    ]);

    // A product directly in a top-level category has parentCategory === null.
    const topLevelRow = await db
      .prepare("SELECT slug FROM products WHERE category_id = ? AND slug != ? LIMIT 1")
      .bind("drinkware", "red-polka-bow-cup-bread-plate")
      .first<{ slug: string }>();
    expect(topLevelRow?.slug).toBeTruthy();
    const topPage = await getProductBySlug(
      { imageBase: "https://images.cavarabd.com", db: () => db },
      topLevelRow!.slug,
    );
    expect(topPage.category?.id).toBe("drinkware");
    expect(topPage.parentCategory).toBeNull();
  });

  test("meta descriptions fall back and stay under ~160 characters", () => {
    expect(metaDescription({ ...product, summary: "" }, "Fallback")).toBe("Fallback");
    const long = metaDescription({ ...product, summary: "word ".repeat(60) }, "x");
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

test("sitemap lists home, the products page, the content pages, each collection and every product, escaped", () => {
  const xml = sitemapXml(SITE, [{ slug: "a" }, { slug: "b&c" }], [{ id: "drinkware" }, { id: "jars" }]);
  expect(xml).toContain("<loc>https://cavarabd.com/products</loc>");
  for (const page of ["collections", "about", "contact"])
    expect(xml).toContain(`<loc>https://cavarabd.com/${page}</loc>`);
  expect(xml).toContain("<loc>https://cavarabd.com/collections/drinkware</loc>");
  expect(xml).toContain("<loc>https://cavarabd.com/collections/jars</loc>");
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  expect(xml).toContain("<loc>https://cavarabd.com/</loc>");
  expect(xml).toContain("<loc>https://cavarabd.com/products/a</loc>");
  expect(xml).toContain("<loc>https://cavarabd.com/products/b&amp;c</loc>");
});

test("www redirects to the bare domain, keeping path and query; other hosts are left alone", () => {
  expect(canonicalRedirect(new URL("https://www.cavarabd.com/products/x?variant=2"), "cavarabd.com")).toBe(
    "https://cavarabd.com/products/x?variant=2",
  );
  expect(canonicalRedirect(new URL("https://cavarabd.com/"), "cavarabd.com")).toBeNull();
  expect(canonicalRedirect(new URL("http://localhost:3000/"), "cavarabd.com")).toBeNull();
});

describe("listing pages", () => {
  test("/products has its own title, description and a clean canonical", () => {
    const seo = listingSeo(SITE, null, "Fallback");
    expect(seo.title).toBe("All products — Cavara");
    expect(seo.description.length).toBeGreaterThan(40);
    expect(seo.url).toBe("https://cavarabd.com/products");
    expect(seo.image).toBeUndefined();
  });
  test("a collection uses its name, description, own URL and image", () => {
    const seo = listingSeo(
      SITE,
      { id: "drinkware", name: "Drinkware", description: "Cups and mugs.", image: "/media/drink.webp" },
      "Fallback",
    );
    expect(seo).toEqual({
      title: "Drinkware — Cavara",
      description: "Cups and mugs.",
      url: "https://cavarabd.com/collections/drinkware",
      image: "https://cavarabd.com/media/drink.webp",
    });
  });
  test("a renamed collection without path falls back to categorySlug instead of retired id", () => {
    const seo = listingSeo(
      SITE,
      {
        id: "drinkware",
        slug: "cups-and-mugs",
        name: "Cups & Mugs",
        description: "Cups and mugs.",
        image: "/media/drink.webp",
      },
      "Fallback",
    );
    expect(seo.url).toBe("https://cavarabd.com/collections/cups-and-mugs");
  });
  test("a collection without a description falls back", () => {
    expect(listingSeo(SITE, category, "Fallback").description).toBe("Fallback");
  });
  test("collection URLs encode the id", () => {
    expect(collectionUrl(`${SITE}/`, "a b")).toBe("https://cavarabd.com/collections/a%20b");
  });
});

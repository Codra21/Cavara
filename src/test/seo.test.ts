import { describe, expect, test } from "bun:test";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  canonicalRedirect,
  metaDescription,
  productAvailability,
  productJsonLd,
  sitemapXml,
} from "@/domain/seo";
import type { Category, Product } from "@/lib/types";

const SITE = "https://cavarabd.com";
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
      [2, "Drinkware", "https://cavarabd.com/?category=drinkware"],
      [3, "Red Polka Cup & Plate", "https://cavarabd.com/products/red-polka-cup"],
    ]);
  });

  test("meta descriptions fall back and stay under ~160 characters", () => {
    expect(metaDescription({ ...product, summary: "" }, "Fallback")).toBe("Fallback");
    const long = metaDescription({ ...product, summary: "word ".repeat(60) }, "x");
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

test("sitemap lists home and products, escaped", () => {
  const xml = sitemapXml(SITE, [{ slug: "a" }, { slug: "b&c" }]);
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

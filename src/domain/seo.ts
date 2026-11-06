// Search and sharing metadata built from the catalogue. Pure: no React, no D1.
// Schema.org types: https://schema.org/Product, /Offer, /BreadcrumbList. Google reads them from JSON-LD in the
// server-rendered HTML, so these run in route head() and appear in the raw SSR response.
import type { Availability, Category, Product } from "@/lib/types";

/**
 * Absolute URL for an image or path. Catalogue images are already absolute on production
 * (https://images.cavarabd.com/…); local and fallback paths start with "/" and get the site origin.
 */
export function absoluteUrl(siteUrl: string, src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${siteUrl.replace(/\/+$/, "")}${encodeURI(src.startsWith("/") ? src : `/${src}`)}`;
}

export function productUrl(siteUrl: string, product: Pick<Product, "slug">): string {
  return `${siteUrl.replace(/\/+$/, "")}/products/${product.slug}`;
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  preorder: "https://schema.org/PreOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

/** In stock if any colour is, else pre-order if any colour is, else out of stock. */
export function productAvailability(product: Product): Availability {
  const states = product.variants.map((variant) => variant.availability ?? "in_stock");
  if (states.includes("in_stock")) return "in_stock";
  if (states.includes("preorder")) return "preorder";
  return "out_of_stock";
}

/** Short plain-text description for meta tags: the summary, else the first detail, trimmed to ~160 characters. */
export function metaDescription(product: Product, fallback: string): string {
  const text = (product.summary || product.details?.[0] || fallback).replace(/\s+/g, " ").trim();
  return text.length <= 160 ? text : `${text.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

export function productJsonLd(product: Product, category: Category | undefined, siteUrl: string) {
  const url = productUrl(siteUrl, product);
  const images = [...new Set(product.variants.flatMap((variant) => variant.images))].map((src) =>
    absoluteUrl(siteUrl, src),
  );
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: metaDescription(product, product.name),
    image: images,
    url,
    sku: String(product.id),
    brand: { "@type": "Brand", name: "Cavara" },
    ...(category ? { category: category.name } : {}),
    offers: {
      "@type": "Offer",
      url,
      price: product.price,
      priceCurrency: "BDT",
      availability: SCHEMA_AVAILABILITY[productAvailability(product)],
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "Cavara" },
    },
  };
}

export function breadcrumbJsonLd(product: Product, category: Category | undefined, siteUrl: string) {
  const base = siteUrl.replace(/\/+$/, "");
  const items = [
    { name: "Home", item: `${base}/` },
    ...(category ? [{ name: category.name, item: `${base}/?category=${encodeURIComponent(category.id)}` }] : []),
    { name: product.name, item: productUrl(siteUrl, product) },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({ "@type": "ListItem", position: index + 1, ...entry })),
  };
}

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]!,
  );

/** sitemap.xml for the home page and every published product (https://www.sitemaps.org/protocol.html). */
export function sitemapXml(siteUrl: string, products: Pick<Product, "slug">[]): string {
  const base = siteUrl.replace(/\/+$/, "");
  const urls = [`${base}/`, ...products.map((product) => productUrl(siteUrl, product))];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

/** The www host redirects to the bare domain so search engines see one copy of each page. */
export function canonicalRedirect(url: URL, canonicalHost: string): string | null {
  if (url.hostname !== `www.${canonicalHost}`) return null;
  const target = new URL(url.toString());
  target.hostname = canonicalHost;
  target.protocol = "https:";
  target.port = "";
  return target.toString();
}

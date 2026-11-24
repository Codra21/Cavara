// Search and sharing metadata built from the catalogue. Pure: no React, no D1.
// Schema.org types: https://schema.org/Product, /Offer, /BreadcrumbList. Google reads them from JSON-LD in the
// server-rendered HTML, so these run in route head() and appear in the raw SSR response.
import type { Availability, Category, Product } from "@/lib/types";

/** What the product metadata reads. Both the legacy `Product` and the product page's detail object fit. */
export interface SeoProduct extends Pick<Product, "id" | "slug" | "name" | "price" | "summary"> {
  details?: readonly string[];
  variants: readonly { images: readonly string[]; availability?: Availability | undefined }[];
}

/**
 * Absolute URL for an image or path. Catalogue images are already absolute on production
 * (https://images.cavarabd.com/…); local and fallback paths start with "/" and get the site origin.
 */
const trimSlash = (siteUrl: string) => siteUrl.replace(/\/+$/, "");

export function absoluteUrl(siteUrl: string, src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${trimSlash(siteUrl)}${encodeURI(src.startsWith("/") ? src : `/${src}`)}`;
}

export function productUrl(siteUrl: string, product: Pick<Product, "slug">): string {
  return `${trimSlash(siteUrl)}/products/${product.slug}`;
}

/** The all-products page. Filters, sort and page numbers are never part of the canonical URL. */
export const productsUrl = (siteUrl: string) => `${trimSlash(siteUrl)}/products`;

export const collectionUrl = (siteUrl: string, categoryId: string) =>
  `${trimSlash(siteUrl)}/collections/${encodeURIComponent(categoryId)}`;

export interface ListingSeo {
  title: string;
  description: string;
  /** Canonical and og:url. */
  url: string;
  /** Absolute image for og:image, when the page has its own. */
  image?: string;
}

/** Title, description and canonical for `/products` (no category) or `/collections/<category>`. */
export function listingSeo(siteUrl: string, category: Category | null, fallbackDescription: string): ListingSeo {
  if (!category)
    return {
      title: "All products — Cavara",
      description:
        "Browse every Cavara piece: ceramics, serveware, kitchen storage and home accessories, delivered across Bangladesh.",
      url: productsUrl(siteUrl),
    };
  const description = category.description.replace(/\s+/g, " ").trim() || fallbackDescription;
  return {
    title: `${category.name} — Cavara`,
    description,
    url: collectionUrl(siteUrl, category.id),
    ...(category.image ? { image: absoluteUrl(siteUrl, category.image) } : {}),
  };
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  preorder: "https://schema.org/PreOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

/** In stock if any colour is, else pre-order if any colour is, else out of stock. */
export function productAvailability(product: SeoProduct): Availability {
  const states = product.variants.map((variant) => variant.availability ?? "in_stock");
  if (states.includes("in_stock")) return "in_stock";
  if (states.includes("preorder")) return "preorder";
  return "out_of_stock";
}

/** Short plain-text description for meta tags: the summary, else the first detail, trimmed to ~160 characters. */
export function metaDescription(product: SeoProduct, fallback: string): string {
  const text = (product.summary || product.details?.[0] || fallback).replace(/\s+/g, " ").trim();
  return text.length <= 160 ? text : `${text.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

export function productJsonLd(product: SeoProduct, category: Category | undefined, siteUrl: string) {
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

export function breadcrumbJsonLd(product: SeoProduct, category: Category | undefined, siteUrl: string) {
  const items = [
    { name: "Home", item: `${trimSlash(siteUrl)}/` },
    ...(category ? [{ name: category.name, item: collectionUrl(siteUrl, category.id) }] : []),
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

/**
 * sitemap.xml for the home page, the all-products page, each category's page and every published product
 * (https://www.sitemaps.org/protocol.html).
 */
export function sitemapXml(
  siteUrl: string,
  products: Pick<Product, "slug">[],
  categories: Pick<Category, "id">[] = [],
): string {
  const urls = [
    `${trimSlash(siteUrl)}/`,
    productsUrl(siteUrl),
    ...categories.map((category) => collectionUrl(siteUrl, category.id)),
    ...products.map((product) => productUrl(siteUrl, product)),
  ];
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

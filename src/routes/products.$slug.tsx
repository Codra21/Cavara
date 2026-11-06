import { createFileRoute, notFound } from "@tanstack/react-router";
import { getVariant, indexCatalog } from "@/domain/catalog";
import { catalogQueryOptions } from "@/lib/query";
import { absoluteUrl, breadcrumbJsonLd, metaDescription, productJsonLd, productUrl } from "@/domain/seo";
import { SHARE_DESCRIPTION, SITE_URL } from "@/lib/config";
import { ProductPage } from "@/components/product/ProductPage";

interface ProductSearch {
  variant?: number;
}

export const Route = createFileRoute("/products/$slug")({
  validateSearch: (search: Record<string, unknown>): ProductSearch => {
    const variant = Number(search.variant);
    return Number.isInteger(variant) && variant >= 0 ? { variant } : {};
  },
  loader: async ({ context, params }) => {
    const catalog = indexCatalog(await context.queryClient.query(catalogQueryOptions()));
    const product = catalog.productBySlug.get(params.slug);
    if (!product) throw notFound();
    return { product, category: catalog.categoryById.get(product.category) };
  },
  head: ({ loaderData }) => {
    const product = loaderData?.product;
    if (!product) return {};
    const category = loaderData?.category;
    const url = productUrl(SITE_URL, product);
    const image = absoluteUrl(SITE_URL, getVariant(product).images[0] ?? "/og-image.jpg");
    const title = `${product.name} — Cavara`;
    const description = metaDescription(product, SHARE_DESCRIPTION);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "product" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { property: "og:image:alt", content: `${product.name}, ${getVariant(product).name}` },
        { property: "product:price:amount", content: String(product.price) },
        { property: "product:price:currency", content: "BDT" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
        { "script:ld+json": productJsonLd(product, category, SITE_URL) },
        { "script:ld+json": breadcrumbJsonLd(product, category, SITE_URL) },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: ProductRoute,
});

function ProductRoute() {
  const { product } = Route.useLoaderData();
  const { variant } = Route.useSearch();
  return <ProductPage key={product.id} product={product} initialVariant={variant} />;
}

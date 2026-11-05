import { createFileRoute, notFound } from "@tanstack/react-router";
import { getVariant, productBySlug } from "~/lib/catalog";
import { SITE_URL } from "~/lib/config";
import { ProductPage } from "~/components/product/ProductPage";

interface ProductSearch {
  variant?: number;
}

export const Route = createFileRoute("/products/$slug")({
  validateSearch: (search: Record<string, unknown>): ProductSearch => {
    const variant = Number(search.variant);
    return Number.isInteger(variant) && variant >= 0 ? { variant } : {};
  },
  loader: ({ params }) => {
    const product = productBySlug.get(params.slug);
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => {
    const product = loaderData?.product;
    if (!product) return {};
    const url = `${SITE_URL}/products/${product.slug}`;
    const image = `${SITE_URL}${encodeURI(getVariant(product).images[0] ?? "")}`;
    const title = `${product.name} — Cavara`;
    return {
      meta: [
        { title },
        { name: "description", content: product.summary },
        { property: "og:type", content: "product" },
        { property: "og:title", content: title },
        { property: "og:description", content: product.summary },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: product.summary },
        { name: "twitter:image", content: image },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            description: product.summary,
            image: product.variants.flatMap((variant) => variant.images).map((src) => `${SITE_URL}${encodeURI(src)}`),
            brand: { "@type": "Brand", name: "Cavara" },
            offers: { "@type": "Offer", price: product.price, priceCurrency: "BDT", url },
          },
        },
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

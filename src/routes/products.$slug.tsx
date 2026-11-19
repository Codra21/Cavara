import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getVariant, isProductSlug } from "@/domain/catalog";
import { productQueryOptions, relatedQueryOptions } from "@/lib/query";
import { safeLoad } from "@/lib/safe-load";
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
    // A slug the editor could never have written is not found; the server function would reject it as bad input.
    if (!isProductSlug(params.slug)) throw notFound();
    const [{ product, category }] = await safeLoad("product page", () =>
      Promise.all([
        context.queryClient.query(productQueryOptions(params.slug)),
        // Related pieces are below the fold; a failure leaves the row empty instead of failing the page.
        context.queryClient.prefetchQuery(relatedQueryOptions(params.slug)),
      ]),
    );
    if (!product) throw notFound();
    // head() below needs the product too. The component reads the same data back from the query cache.
    return { product, category };
  },
  head: ({ loaderData }) => {
    const product = loaderData?.product;
    if (!product) return {};
    const category = loaderData?.category ?? undefined;
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
  const { slug } = Route.useParams();
  const { variant } = Route.useSearch();
  const { data } = useSuspenseQuery(productQueryOptions(slug));
  // The loader found it, but a later refetch (stale after 5 minutes) can find it archived.
  if (!data.product) throw notFound();
  return <ProductPage key={data.product.id} product={data.product} category={data.category} initialVariant={variant} />;
}

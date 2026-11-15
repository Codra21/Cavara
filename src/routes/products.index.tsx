import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseListSearch, type ListSearch } from "@/domain/product-listing";
import { listingHead, loadListing } from "@/lib/listing-route";
import { ProductListing } from "@/components/shop/ProductListing";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): ListSearch => parseListSearch(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { category, pageCount } = await loadListing(context.queryClient, undefined, deps);
    // A page past the end (a stale link, or products removed since) goes to the last page.
    if (deps.page && deps.page > pageCount)
      throw redirect({
        to: "/products",
        search: { ...deps, page: pageCount > 1 ? pageCount : undefined },
        statusCode: 302,
      });
    return { category };
  },
  head: () => listingHead(null),
  component: ProductsRoute,
});

function ProductsRoute() {
  return <ProductListing search={Route.useSearch()} />;
}

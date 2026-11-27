import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { parseListSearch, type ListSearch } from "@/domain/product-listing";
import { listingHead, loadListing } from "@/lib/listing-route";
import { ProductListing } from "@/components/shop/ProductListing";

export const Route = createFileRoute("/collections/$category/$subcategory")({
  validateSearch: (search: Record<string, unknown>): ListSearch => parseListSearch(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, params }) => {
    const { category, pageCount } = await loadListing(context.queryClient, params.subcategory, deps);
    if (!category || !category.parentId) throw notFound();
    if (deps.page && deps.page > pageCount) {
      throw redirect({
        to: "/collections/$category/$subcategory",
        params,
        search: { ...deps, page: pageCount > 1 ? pageCount : undefined },
        statusCode: 302,
      });
    }
    return { category };
  },
  head: ({ loaderData }) => listingHead(loaderData?.category),
  component: SubcategoryRoute,
});

function SubcategoryRoute() {
  const { subcategory } = Route.useParams();
  return <ProductListing category={subcategory} search={Route.useSearch()} />;
}

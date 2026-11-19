// TanStack Query options shared by route loaders (queryClient.query) and components (useSuspenseQuery / useQuery).
import { keepPreviousData, queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { type ListQuery, normalizeQuery } from "@/domain/product-listing";
import {
  getCategoriesFn,
  getHomeFn,
  getProductBySlugFn,
  getProductsByIdsFn,
  getRelatedProductsFn,
  listProductsFn,
} from "@/server/functions/catalog.functions";
import type { CategoriesData } from "@/server/catalog-queries.server";

/** Public answers are cached at the edge for 5 minutes (PUBLIC_CACHE_CONTROL); the browser keeps them as long. */
const PUBLIC_STALE_TIME = 5 * 60 * 1000;

/** Categories with images and product counts. The root loader prefetches it, so the header, footer and tiles never suspend. */
export const categoriesQueryOptions = () =>
  queryOptions({
    queryKey: ["categories"],
    queryFn: () => getCategoriesFn(),
    // The SSR result is reused after hydration instead of being refetched immediately.
    staleTime: PUBLIC_STALE_TIME,
    // Coming back to a tab would otherwise refetch (one Worker request each). Navigation still refetches once stale.
    refetchOnWindowFocus: false,
  });

export interface Categories {
  imageBase: string;
  categories: CategoriesData["categories"];
  categoryById: Map<string, CategoriesData["categories"][number]>;
}

const withLookup = (data: CategoriesData): Categories => ({
  ...data,
  categoryById: new Map(data.categories.map((category) => [category.id, category])),
});

/** The categories and the image origin, from the root loader's prefetch. */
export function useCategories(): Categories {
  return useSuspenseQuery({ ...categoriesQueryOptions(), select: withLookup }).data;
}

/** The home page's rows, hero, lookbook, promo and carousel. */
export const homeQueryOptions = () =>
  queryOptions({
    queryKey: ["home"],
    queryFn: () => getHomeFn(),
    staleTime: PUBLIC_STALE_TIME,
    refetchOnWindowFocus: false,
  });

/** One page of the product listing. `query` is normalised so equal lists share one cache entry. */
export const listingQueryOptions = (query: ListQuery) => {
  const data = normalizeQuery(query);
  return queryOptions({
    queryKey: ["listing", data],
    queryFn: () => listProductsFn({ data }),
    staleTime: PUBLIC_STALE_TIME,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
};

/** One product with everything the product page and quick view show. `product` is null for an unknown slug. */
export const productQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["product", slug],
    queryFn: () => getProductBySlugFn({ data: { slug } }),
    staleTime: PUBLIC_STALE_TIME,
    refetchOnWindowFocus: false,
  });

/** Suggestions under a product page (summary only). */
export const relatedQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["related", slug],
    queryFn: () => getRelatedProductsFn({ data: { slug } }),
    staleTime: PUBLIC_STALE_TIME,
    refetchOnWindowFocus: false,
  });

/** The distinct product ids of some bag or recent lines, sorted so the same set always shares one cache entry. */
export const lookupIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * Cards, delivery areas and unavailable ids for a bag or recently-viewed list. Client-only (bag and history live in
 * localStorage), so components read it with useQuery, not useSuspenseQuery. `ids` must come from `lookupIds`.
 */
export const productsByIdsQueryOptions = (ids: number[]) =>
  queryOptions({
    queryKey: ["products-by-ids", ids],
    queryFn: () => getProductsByIdsFn({ data: { ids } }),
    staleTime: PUBLIC_STALE_TIME,
    refetchOnWindowFocus: false,
    // Adding a line changes the id set. Keep the old answer on screen while the new one loads; resolveBagLines marks
    // the new line as pending.
    placeholderData: keepPreviousData,
  });

/** The home page's data, from the route loader's prefetch. */
export const useHome = () => useSuspenseQuery(homeQueryOptions()).data;

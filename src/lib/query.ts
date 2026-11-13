// TanStack Query options shared by route loaders (queryClient.query) and components (useSuspenseQuery / useQuery).
import { keepPreviousData, queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { indexCatalog, type CatalogIndex } from "@/domain/catalog";
import {
  getCatalogFn,
  getProductBySlugFn,
  getProductsByIdsFn,
  getRelatedProductsFn,
} from "@/server/functions/catalog.functions";

/** Public answers are cached at the edge for 5 minutes (PUBLIC_CACHE_CONTROL); the browser keeps them as long. */
const PUBLIC_STALE_TIME = 5 * 60 * 1000;

export const catalogQueryOptions = () =>
  queryOptions({
    queryKey: ["catalog"],
    queryFn: () => getCatalogFn(),
    // The SSR result is reused after hydration instead of being refetched immediately.
    staleTime: PUBLIC_STALE_TIME,
    // Coming back to a tab would otherwise refetch (one Worker request each). Navigation still refetches once stale,
    // and checkout re-prices on the server (invariant 3).
    refetchOnWindowFocus: false,
  });

/** The published catalogue with lookup maps. The root loader prefetches it, so this never suspends after SSR. */
export function useCatalog(): CatalogIndex {
  return useSuspenseQuery({ ...catalogQueryOptions(), select: indexCatalog }).data;
}

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

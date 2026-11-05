// TanStack Query options shared by route loaders (ensureQueryData) and components (useSuspenseQuery).
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { indexCatalog, type CatalogIndex } from "@/domain/catalog";
import { getCatalogFn } from "@/server/functions/catalog.functions";

export const catalogQueryOptions = () =>
  queryOptions({
    queryKey: ["catalog"],
    queryFn: () => getCatalogFn(),
    // The SSR result is reused after hydration instead of being refetched immediately.
    staleTime: 5 * 60 * 1000,
  });

/** The published catalogue with lookup maps. The root loader prefetches it, so this never suspends after SSR. */
export function useCatalog(): CatalogIndex {
  return useSuspenseQuery({ ...catalogQueryOptions(), select: indexCatalog }).data;
}

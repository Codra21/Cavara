import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type BagLine, resolveBagLines } from "@/domain/bag";
import { lookupIds, productsByIdsQueryOptions } from "@/lib/query";
import type { BagItem } from "@/lib/types";

/**
 * The bag's lines with names, prices, pictures and availability, from getProductsByIdsFn for the ids in the bag.
 * `enabled` keeps the request until the drawer opens, so a visitor who never opens the bag costs no Worker request.
 * Lines stay `pending` until the lookup answers, and a lookup that fails leaves them pending with `failed` set.
 */
export function useBagLines(bag: BagItem[], enabled: boolean) {
  const ids = lookupIds(bag.map((item) => item.id));
  const query = useQuery({ ...productsByIdsQueryOptions(ids), enabled: enabled && ids.length > 0 });
  const lines = useMemo<BagLine[]>(() => resolveBagLines(bag, query.data), [bag, query.data]);
  return {
    lines,
    /** Active delivery areas from the same answer. Empty until it arrives. */
    zones: query.data?.zones ?? [],
    /** True when the lookup failed and there is no earlier answer to show. */
    failed: query.isError && !query.data,
    retry: () => void query.refetch(),
  };
}

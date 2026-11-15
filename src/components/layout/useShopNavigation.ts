import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { focusProductSearch } from "@/lib/dom";

/**
 * Goes to the product listing: `/products`, or `/collections/<category>` with a category. With `focusSearch`, moves
 * focus into the listing's search field, as soon as the page has rendered it. Already on a listing, a search focus
 * keeps the page and its filters.
 */
export function useShopNavigation() {
  const navigate = useNavigate();

  return useCallback(
    async ({ category, focusSearch = false }: { category?: string; focusSearch?: boolean } = {}) => {
      if (!(focusSearch && !category && focusProductSearch())) {
        if (category && category !== "all") await navigate({ to: "/collections/$category", params: { category } });
        else await navigate({ to: "/products" });
        if (focusSearch) focusProductSearch({ retryFrames: 30 });
      }
    },
    [navigate],
  );
}

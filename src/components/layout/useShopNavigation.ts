import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";
import { scrollToShop } from "@/lib/dom";

/**
 * Jumps to the shop section (optionally with a collection filter or focused search),
 * navigating home first when the visitor is on another route.
 */
export function useShopNavigation() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return useCallback(
    async ({ category, focusSearch = false }: { category?: string; focusSearch?: boolean } = {}) => {
      if (pathname !== "/" || category !== undefined) {
        await navigate({
          to: "/",
          search: (prev: Record<string, unknown>) => ({ ...(pathname === "/" ? prev : {}), category: category === "all" ? undefined : category ?? (prev.category as string | undefined) }),
          hashScrollIntoView: false,
          resetScroll: false,
          replace: pathname === "/",
        });
      }
      window.requestAnimationFrame(() => scrollToShop({ focusSearch }));
    },
    [navigate, pathname]
  );
}

import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/** Opens the full product page, optionally preselecting a colour. */
export function useOpenProduct() {
  const navigate = useNavigate();
  return useCallback(
    (product: { slug: string }, variant?: number) =>
      navigate({
        to: "/products/$slug",
        params: { slug: product.slug },
        search: variant === undefined ? {} : { variant },
      }),
    [navigate],
  );
}

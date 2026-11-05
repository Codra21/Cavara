import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { Product } from "@/lib/types";

/** Opens the full product page, optionally preselecting a colour. */
export function useOpenProduct() {
  const navigate = useNavigate();
  return useCallback(
    (product: Product, variant?: number) =>
      navigate({ to: "/products/$slug", params: { slug: product.slug }, search: variant === undefined ? {} : { variant } }),
    [navigate]
  );
}

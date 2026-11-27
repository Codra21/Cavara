import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { collectionSegments, findCategory } from "@/domain/catalog";
import type { ListSearch } from "@/domain/product-listing";
import { useCategories } from "@/lib/query";

/**
 * The route and params for a category's page, by id or slug: `/collections/<slug>` or, for a subcategory,
 * `/collections/<parent>/<slug>`. Linking by the current slugs avoids a 301 on every click after a rename.
 */
export function useCollectionTarget() {
  const { categories } = useCategories();
  return (key: string) => {
    const category = findCategory(categories, key);
    return category ? collectionSegments(category, categories) : { category: key };
  };
}

export function CategoryLink({
  category,
  search,
  children,
  ...rest
}: {
  /** A category id or slug. */
  category: string;
  search?: ListSearch;
  children: ReactNode;
  className?: string;
  "aria-current"?: "page";
  "aria-label"?: string;
  activeOptions?: { exact?: boolean };
  onClick?: () => void;
}) {
  const target = useCollectionTarget()(category);
  return target.subcategory ? (
    <Link
      to="/collections/$category/$subcategory"
      params={{ category: target.category, subcategory: target.subcategory }}
      search={search ?? {}}
      {...rest}
    >
      {children}
    </Link>
  ) : (
    <Link to="/collections/$category" params={{ category: target.category }} search={search ?? {}} {...rest}>
      {children}
    </Link>
  );
}

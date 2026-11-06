import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SORT_OPTIONS, countInCategory, filterProducts, pluralize, type SortKey } from "@/domain/catalog";
import { useCatalog } from "@/lib/query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { SHOP_PAGE_SIZE } from "@/lib/config";
import { Icon } from "@/components/ui/primitives";
import { ProductCard } from "./ProductCard";

/** Product listing: collection chips (synced to `?category=`), search, sort and "load more". */
export function ShopSection({ category: requested }: { category: string }) {
  const catalog = useCatalog();
  // ?category= is only shape-checked in the route; an id that is not in the catalogue shows everything.
  const category = requested === "all" || catalog.categoryById.has(requested) ? requested : "all";
  const filters = useMemo(
    () => [
      { id: "all", name: "All pieces", count: catalog.products.length },
      ...catalog.categories.map((item) => ({ id: item.id, name: item.name, count: countInCategory(catalog, item.id) })),
    ],
    [catalog],
  );
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [expanded, setExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const focusAfterExpand = useRef(false);

  const searched = useDebouncedValue(query);
  const products = useMemo(
    () => filterProducts(catalog, { category, query: searched, sort }),
    [catalog, category, searched, sort],
  );
  const collapsed = !expanded && products.length > SHOP_PAGE_SIZE;
  const scope = category === "all" ? "" : ` in ${catalog.categoryById.get(category)?.name ?? ""}`;
  const trimmed = searched.trim();

  useEffect(() => {
    if (!focusAfterExpand.current) return;
    focusAfterExpand.current = false;
    gridRef.current?.children[SHOP_PAGE_SIZE]
      ?.querySelector<HTMLButtonElement>(".product-name button")
      ?.focus({ preventScroll: true });
  }, [expanded]);

  const setCategory = (id: string) =>
    navigate({
      to: "/",
      search: (prev) => ({ ...prev, category: id === "all" ? undefined : id }),
      replace: true,
      resetScroll: false,
    });

  return (
    <section className="section shop" id="shop" aria-labelledby="shop-title" tabIndex={-1}>
      <div className="container-wide">
        <div className="section-head" data-reveal="">
          <p className="sub-heading">Trending pieces</p>
          <h2 id="shop-title">The collection</h2>
          <p className="section-note" aria-live="polite">
            {trimmed
              ? `${pluralize(products.length, "piece")}${scope} for “${trimmed}”`
              : `Showing ${pluralize(products.length, "piece")}${scope}`}
          </p>
        </div>

        <div className="shop-toolbar" data-reveal="">
          <div className="filter-chips" role="group" aria-label="Filter by collection">
            {filters.map((filter) => (
              <button
                key={filter.id}
                className="filter-chip"
                type="button"
                aria-pressed={filter.id === category}
                onClick={() => setCategory(filter.id)}
              >
                {filter.name} <span className="filter-chip-count">{filter.count}</span>
              </button>
            ))}
          </div>
          <div className="shop-controls">
            <label className="search-field">
              <Icon name="fa-solid fa-magnifying-glass" />
              <span className="sr-only">Search products</span>
              <input
                ref={searchRef}
                type="search"
                id="product-search"
                placeholder="Search cups, dishes, jars…"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="sort-field">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <ul
          ref={gridRef}
          className={`product-grid${collapsed ? " is-collapsed" : ""}`}
          aria-label="Products"
          hidden={products.length === 0}
        >
          {products.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </ul>

        <div className="studio-load-more" hidden={!collapsed}>
          <p>
            Showing {SHOP_PAGE_SIZE} of {products.length}
          </p>
          <button
            className="button button-outline"
            type="button"
            onClick={() => {
              focusAfterExpand.current = true;
              setExpanded(true);
            }}
          >
            Load more pieces
          </button>
        </div>

        <div className="empty-state" hidden={products.length > 0}>
          <Icon name="fa-regular fa-face-meh" />
          <h3>{trimmed ? `No pieces match “${trimmed}”` : "No pieces in this collection yet"}</h3>
          <p>Try a different word, or browse every collection.</p>
          <button
            className="button button-outline"
            type="button"
            onClick={() => {
              setQuery("");
              void setCategory("all");
              searchRef.current?.focus();
            }}
          >
            Clear filters
          </button>
        </div>
      </div>
    </section>
  );
}

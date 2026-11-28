import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@ui-sdk/react/input";
import { Label } from "@ui-sdk/react/label";
import { NumberInput, NumberInputControl } from "@ui-sdk/react/number-input";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { findCategory, pluralize } from "@/domain/catalog";
import {
  AVAILABILITY_LABELS,
  cleanSearchText,
  DEFAULT_SORT,
  hasActiveFilters,
  MAX_PRICE,
  offersChoice,
  parseListSearch,
  SORT_KEYS,
  SORT_LABELS,
  withoutPage,
  type ListSearch,
  type SortKey,
} from "@/domain/product-listing";
import { listingQueryOptions, useCategories } from "@/lib/query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Icon } from "@/components/ui/primitives";
import { ProductCard } from "@/components/home/ProductCard";
import { CategoryLink, useCollectionTarget } from "./CategoryLink";

/** A link to a listing page: `/collections/<category>` with a category, `/products` without one. */
function ListingLink({
  category,
  search,
  children,
  ...rest
}: {
  category: string | undefined;
  search: ListSearch;
  children: ReactNode;
  className?: string;
  "aria-current"?: "page";
  "aria-label"?: string;
  onClick?: () => void;
}) {
  return category ? (
    <CategoryLink category={category} search={search} activeOptions={{ exact: true }} {...rest}>
      {children}
    </CategoryLink>
  ) : (
    <Link to="/products" search={search} activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  );
}

/** A committed price field value: a whole number of taka, or nothing. */
const toPrice = (value: number | null) => (value === null ? undefined : parseListSearch({ min: String(value) }).min);

/** Page numbers to link: the first, the last and the ones beside the current page, with gaps marked as null. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    const before = sorted[i - 1];
    if (before !== undefined && n - before > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/**
 * The product grid behind `/products` and `/collections/<category>`. The URL holds the filters, the sort and the page;
 * the server renders that page. "Load more" fetches the next page into the grid and writes `?page=`, while the
 * numbered links under the grid are ordinary links a crawler can follow.
 */
export function ProductListing({ category, search }: { category?: string; search: ListSearch }) {
  const navigate = useNavigate();
  const page = search.page ?? 1;
  const signature = JSON.stringify([category ?? null, withoutPage(search)]);

  // The grid shows pages `start` to `end` of one list. A different list, or a page outside that run (a pager link, the
  // back button), starts a new run at the page in the URL.
  const [expandedRun, setExpandedRun] = useState<{ signature: string; start: number; end: number } | null>(null);
  const isRunValid =
    expandedRun !== null && expandedRun.signature === signature && page >= expandedRun.start && page <= expandedRun.end;
  const current = isRunValid ? expandedRun : { signature, start: page, end: page };

  const latestSearch = useRef(search);
  // `category` is the URL segment (a slug); links and navigation below take the category's id.
  const { categories } = useCategories();
  const categoryId = category ? (findCategory(categories, category)?.id ?? category) : undefined;
  const latestCategory = useRef(categoryId);
  useEffect(() => {
    latestSearch.current = search;
    latestCategory.current = categoryId;
  });

  const baseQuery = { ...withoutPage(search), ...(category ? { category } : {}) };
  const pageNumbers = Array.from({ length: current.end - current.start + 1 }, (_, index) => current.start + index);
  const results = useQueries({
    queries: pageNumbers.map((number) => listingQueryOptions({ ...baseQuery, page: number })),
  });
  const head = results.find((result) => result.data)?.data;

  const collectionTarget = useCollectionTarget();
  const go = (next: ListSearch, targetCategory = latestCategory.current) => {
    if (!targetCategory) return navigate({ to: "/products", search: next, replace: true, resetScroll: false });
    const target = collectionTarget(targetCategory);
    return target.subcategory
      ? navigate({
          to: "/collections/$category/$subcategory",
          params: { category: target.category, subcategory: target.subcategory },
          search: next,
          replace: true,
          resetScroll: false,
        })
      : navigate({
          to: "/collections/$category",
          params: { category: target.category },
          search: next,
          replace: true,
          resetScroll: false,
        });
  };
  /** Applies a change to the filters or sort and returns to the first page. */
  const update = (patch: Partial<Record<keyof ListSearch, unknown>>) =>
    void go(parseListSearch({ ...latestSearch.current, ...patch, page: undefined }));

  // Search box: typing applies after a pause, Enter applies at once. `pushed` is the text last written to the URL, so a
  // slow navigation never overwrites what the visitor has typed since.
  const [text, setText] = useState(search.q ?? "");
  const pushed = useRef(search.q ?? "");
  const debounced = useDebouncedValue(text);
  useEffect(() => {
    const clean = cleanSearchText(debounced) ?? "";
    if (clean === pushed.current) return;
    pushed.current = clean;
    update({ q: clean });
  }, [debounced]);
  useEffect(() => {
    const fromUrl = search.q ?? "";
    if (fromUrl === pushed.current && (fromUrl !== "" || text === "")) return;
    pushed.current = fromUrl;
    setText(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncs when URL search changes or is cleared
  }, [search.q]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minPrice, setMinPrice] = useState<number | null>(search.min ?? null);
  const [maxPrice, setMaxPrice] = useState<number | null>(search.max ?? null);
  useEffect(() => setMinPrice(search.min ?? null), [search.min]);
  useEffect(() => setMaxPrice(search.max ?? null), [search.max]);
  // Both bounds go together: a second commit can land before the first navigation re-renders.
  const commitPrice = (bound: "min" | "max", value: number | null) => {
    const min = toPrice(bound === "min" ? value : minPrice);
    const max = toPrice(bound === "max" ? value : maxPrice);
    if (min !== search.min || max !== search.max) update({ min, max });
  };

  const gridRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const cards = results.flatMap((result) => result.data?.products ?? []);
  const categoryNames: Record<string, string> = Object.assign(
    {},
    ...results.map((result) => result.data?.categoryNames),
  );
  // After "Load more", move focus to the first new card so keyboard users continue where the new pieces start.
  useEffect(() => {
    if (focusFrom.current === null || cards.length <= focusFrom.current) return;
    gridRef.current?.children[focusFrom.current]
      ?.querySelector<HTMLElement>(".product-name a")
      ?.focus({ preventScroll: true });
    focusFrom.current = null;
  }, [cards.length]);

  if (results[0]?.isError) {
    return (
      <section className="section shop-section">
        <div className="container">
          <p className="bag-error">Could not load products right now.</p>
          <button className="button button-outline" type="button" onClick={() => void results[0]?.refetch()}>
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (!head) return null;
  const { facets, total, pageCount } = head;
  const lastResult = results[results.length - 1];
  const extraPage = current.end > current.start;
  const hasMore = current.end < pageCount;
  const loadingMore = Boolean(lastResult?.isPending && extraPage);
  const loadFailed = Boolean(lastResult?.isError && extraPage);
  const loadMore = () => {
    const next = current.end + 1;
    focusFrom.current = cards.length;
    setExpandedRun({ signature, start: current.start, end: next });
    void go({ ...latestSearch.current, page: next });
  };

  const filtered = hasActiveFilters(search);
  const name = category ? (head.category?.name ?? "") : "All products";
  const sort = search.sort ?? DEFAULT_SORT;
  // A filter that cannot change the list is hidden, unless the visitor already uses it.
  const { all, inStock, preorder, soldOut } = facets.availability;
  const availabilityCounts = { "in-stock": inStock, preorder, "sold-out": soldOut } as const;
  const availabilityChoices = (["in-stock", "preorder", "sold-out"] as const).filter(
    (choice) => search.availability === choice || offersChoice([availabilityCounts[choice]], all),
  );
  const showAvailability = availabilityChoices.length > 0;
  const showPrice =
    search.min !== undefined ||
    search.max !== undefined ||
    Boolean(facets.price && facets.price.min < facets.price.max);
  const showCategories = facets.categories.length > 1;
  const shownFrom = (current.start - 1) * head.pageSize + 1;
  const shownTo = (current.start - 1) * head.pageSize + cards.length;
  const trimmed = search.q ?? "";
  const keepSort: ListSearch = search.sort ? { sort: search.sort } : {};
  const activePanelFilters =
    Number(Boolean(search.availability)) +
    Number(search.min !== undefined || search.max !== undefined) +
    Number(sort !== DEFAULT_SORT);

  return (
    <section className="section shop listing" aria-labelledby="listing-title">
      <div className="container-wide">
        <nav className="pdp-crumbs listing-crumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/">Home</Link>
            </li>
            {category ? (
              <>
                <li>
                  <Link to="/products">Products</Link>
                </li>
                <li aria-current="page">{name}</li>
              </>
            ) : (
              <li aria-current="page">Products</li>
            )}
          </ol>
        </nav>
        <div className="section-head">
          <p className="sub-heading">{category ? "Collection" : "Shop"}</p>
          <h1 id="listing-title">{name}</h1>
          {category && head.category?.description ? <p className="section-note">{head.category.description}</p> : null}
          <p className="section-note" aria-live="polite">
            {total === 0
              ? "No pieces to show"
              : trimmed
                ? `${pluralize(total, "piece")} for “${trimmed}”`
                : `Showing ${shownFrom === shownTo ? shownFrom : `${shownFrom} to ${shownTo}`} of ${pluralize(total, "piece")}`}
          </p>
        </div>

        {showCategories ? (
          <div className="shop-toolbar">
            <nav className="filter-chips" aria-label="Collections">
              <ListingLink
                className="filter-chip"
                category={undefined}
                search={withoutPage(search)}
                {...(category ? {} : { "aria-current": "page" as const })}
              >
                All pieces <span className="filter-chip-count">{facets.total}</span>
              </ListingLink>
              {facets.categories.map((item) => (
                <ListingLink
                  key={item.id}
                  className="filter-chip"
                  category={item.id}
                  search={withoutPage(search)}
                  {...(item.id === categoryId ? { "aria-current": "page" as const } : {})}
                >
                  {item.name} <span className="filter-chip-count">{item.count}</span>
                </ListingLink>
              ))}
            </nav>
          </div>
        ) : null}

        {/* One row on desktop; secondary filters collapse behind one button on phones. Not ui-sdk Collapsible: its
            closed panel carries `hidden`, which Tailwind preflight forces to display:none on desktop too. */}
        <div className="shop-filters">
          <div className="shop-filters-bar">
            <form
              role="search"
              className="search-field"
              onSubmit={(event) => {
                event.preventDefault();
                const clean = cleanSearchText(text) ?? "";
                if (clean === pushed.current) return;
                pushed.current = clean;
                update({ q: clean });
              }}
            >
              <Icon name="fa-solid fa-magnifying-glass" />
              <Label className="sr-only" htmlFor="product-search">
                Search products
              </Label>
              <Input
                type="search"
                id="product-search"
                placeholder="Search cups, jars…"
                autoComplete="off"
                maxLength={80}
                value={text}
                onValueChange={setText}
              />
            </form>
            <button
              className="button button-outline shop-filters-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="shop-filters-panel"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Icon name="fa-solid fa-sliders" />
              <span>Filters</span>
              {activePanelFilters > 0 ? <span className="shop-filters-badge">{activePanelFilters}</span> : null}
            </button>
          </div>
          <div id="shop-filters-panel" className={`shop-filters-panel${filtersOpen ? " is-open" : ""}`}>
            {showAvailability ? (
              <label className="sort-field">
                <span>Availability</span>
                <select
                  value={search.availability ?? ""}
                  onChange={(event) => update({ availability: event.target.value || undefined })}
                >
                  <option value="">All</option>
                  {availabilityChoices.map((choice) => (
                    <option key={choice} value={choice}>
                      {AVAILABILITY_LABELS[choice]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {showPrice ? (
              <div className="sort-field price-field" role="group" aria-label="Price in taka">
                <span>Price ৳</span>
                <NumberInput
                  value={minPrice}
                  onValueChange={setMinPrice}
                  onValueCommit={(value) => commitPrice("min", value)}
                  min={0}
                  max={MAX_PRICE}
                  locale="en-US"
                  format={{ useGrouping: false, maximumFractionDigits: 0 }}
                >
                  <NumberInputControl
                    inputMode="numeric"
                    aria-label="Lowest price"
                    placeholder={facets.price ? String(facets.price.min) : "Min"}
                  />
                </NumberInput>
                <span aria-hidden="true">to</span>
                <NumberInput
                  value={maxPrice}
                  onValueChange={setMaxPrice}
                  onValueCommit={(value) => commitPrice("max", value)}
                  min={0}
                  max={MAX_PRICE}
                  locale="en-US"
                  format={{ useGrouping: false, maximumFractionDigits: 0 }}
                >
                  <NumberInputControl
                    inputMode="numeric"
                    aria-label="Highest price"
                    placeholder={facets.price ? String(facets.price.max) : "Max"}
                  />
                </NumberInput>
              </div>
            ) : null}
            <label className="sort-field">
              <span>Sort</span>
              <select value={sort} onChange={(event) => update({ sort: event.target.value as SortKey })}>
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            {filtered ? (
              <button className="text-link" type="button" onClick={() => void go(keepSort)}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <ul ref={gridRef} className="product-grid" aria-label="Products" hidden={cards.length === 0}>
          {cards.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={category ? "" : (categoryNames[product.category] ?? "")}
              index={index}
            />
          ))}
        </ul>

        {total === 0 ? (
          <div className="empty-state">
            <Icon name="fa-regular fa-face-meh" />
            <h2>
              {trimmed
                ? `No pieces match “${trimmed}”`
                : filtered
                  ? "No pieces match these filters"
                  : "No pieces here yet"}
            </h2>
            <p>
              {filtered ? "Try a different word or price, or clear the filters." : "Browse every collection instead."}
            </p>
            {filtered ? (
              <button className="button button-outline" type="button" onClick={() => void go(keepSort)}>
                Clear filters
              </button>
            ) : (
              <Link className="button button-outline" to="/products">
                Browse all products
              </Link>
            )}
          </div>
        ) : null}

        {/* The run already ends on the page being fetched, so keep the block for its "Loading…" and "Try again". */}
        {hasMore || loadingMore || loadFailed ? (
          <div className="studio-load-more">
            {loadFailed ? (
              <p className="checkout-error" role="alert">
                We couldn&apos;t load more pieces. Check your connection and try again.
              </p>
            ) : (
              <p>
                Showing {shownTo} of {total}
              </p>
            )}
            <button
              className="button button-outline"
              type="button"
              disabled={loadingMore}
              onClick={() => (loadFailed ? void lastResult?.refetch() : loadMore())}
            >
              {loadFailed ? "Try again" : loadingMore ? "Loading…" : "Load more pieces"}
            </button>
          </div>
        ) : null}

        {pageCount > 1 ? (
          <nav className="pager" aria-label="Pages">
            <ul>
              {pageWindow(page, pageCount).map((number, index) =>
                number === null ? (
                  <li key={`gap-${index}`} aria-hidden="true">
                    …
                  </li>
                ) : (
                  <li key={number}>
                    <ListingLink
                      category={categoryId}
                      search={{ ...search, page: number > 1 ? number : undefined }}
                      aria-label={`Page ${number}`}
                      onClick={() => setExpandedRun(null)}
                      {...(number === page ? { "aria-current": "page" as const } : {})}
                    >
                      {number}
                    </ListingLink>
                  </li>
                ),
              )}
            </ul>
          </nav>
        ) : null}
      </div>
    </section>
  );
}

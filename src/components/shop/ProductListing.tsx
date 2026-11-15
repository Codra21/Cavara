import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { pluralize } from "@/domain/catalog";
import {
  AVAILABILITY_LABELS,
  cleanSearchText,
  DEFAULT_SORT,
  hasActiveFilters,
  offersChoice,
  parseListSearch,
  SORT_KEYS,
  SORT_LABELS,
  withoutPage,
  type ListSearch,
  type SortKey,
} from "@/domain/product-listing";
import { listingQueryOptions } from "@/lib/query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Icon } from "@/components/ui/primitives";
import { ProductCard } from "@/components/home/ProductCard";

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
    <Link to="/collections/$category" params={{ category }} search={search} activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  ) : (
    <Link to="/products" search={search} activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  );
}

/** A price typed in a field: a whole number of taka, or nothing. */
const toPrice = (text: string) => parseListSearch({ min: text.trim() }).min;

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
  const [run, setRun] = useState({ signature, start: page, end: page });
  let current = run;
  if (run.signature !== signature || page < run.start || page > run.end) {
    current = { signature, start: page, end: page };
    setRun(current);
  }

  const baseQuery = { ...withoutPage(search), ...(category ? { category } : {}) };
  const pageNumbers = Array.from({ length: current.end - current.start + 1 }, (_, index) => current.start + index);
  const results = useQueries({
    queries: pageNumbers.map((number) => listingQueryOptions({ ...baseQuery, page: number })),
  });
  const firstWithData = results.find((result) => result.data)?.data;
  const latest = useRef(firstWithData);
  const head = firstWithData ?? latest.current;
  if (head) latest.current = head;

  const go = (next: ListSearch) =>
    category
      ? navigate({
          to: "/collections/$category",
          params: { category },
          search: next,
          replace: true,
          resetScroll: false,
        })
      : navigate({ to: "/products", search: next, replace: true, resetScroll: false });
  /** Applies a change to the filters or sort and returns to the first page. */
  const update = (patch: Partial<Record<keyof ListSearch, unknown>>) =>
    void go(parseListSearch({ ...search, ...patch, page: undefined }));

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
    if (fromUrl === pushed.current) return;
    pushed.current = fromUrl;
    setText(fromUrl);
  }, [search.q]);

  const [minText, setMinText] = useState(search.min?.toString() ?? "");
  const [maxText, setMaxText] = useState(search.max?.toString() ?? "");
  useEffect(() => setMinText(search.min?.toString() ?? ""), [search.min]);
  useEffect(() => setMaxText(search.max?.toString() ?? ""), [search.max]);
  const commitPrice = () => {
    const min = toPrice(minText);
    const max = toPrice(maxText);
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
    setRun({ ...current, end: next });
    void go({ ...search, page: next });
  };

  const filtered = hasActiveFilters(search);
  const name = category ? (head.category?.name ?? "") : "All products";
  const sort = search.sort ?? DEFAULT_SORT;
  // A filter that cannot change the list is hidden, unless the visitor already uses it.
  const { all, inStock, preorder } = facets.availability;
  const availabilityChoices = (["in-stock", "preorder"] as const).filter(
    (choice) => search.availability === choice || offersChoice([choice === "in-stock" ? inStock : preorder], all),
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

        <div className="shop-toolbar">
          {showCategories ? (
            <nav className="filter-chips" aria-label="Collections">
              <ListingLink
                className="filter-chip"
                category={undefined}
                search={withoutPage(search)}
                {...(category ? {} : { "aria-current": "page" as const })}
              >
                All pieces{" "}
                <span className="filter-chip-count">
                  {facets.categories.reduce((sum, item) => sum + item.count, 0)}
                </span>
              </ListingLink>
              {facets.categories.map((item) => (
                <ListingLink
                  key={item.id}
                  className="filter-chip"
                  category={item.id}
                  search={withoutPage(search)}
                  {...(item.id === category ? { "aria-current": "page" as const } : {})}
                >
                  {item.name} <span className="filter-chip-count">{item.count}</span>
                </ListingLink>
              ))}
            </nav>
          ) : (
            <span />
          )}
          <div className="shop-controls">
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
              <label className="sr-only" htmlFor="product-search">
                Search products
              </label>
              <input
                type="search"
                id="product-search"
                placeholder="Search cups, dishes, jars…"
                autoComplete="off"
                maxLength={80}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </form>
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
          </div>
        </div>

        {showAvailability || showPrice || filtered ? (
          <div className="shop-filters" role="group" aria-label="Filters">
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
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label="Lowest price"
                  placeholder={facets.price ? String(facets.price.min) : "Min"}
                  value={minText}
                  onChange={(event) => setMinText(event.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(event) => event.key === "Enter" && commitPrice()}
                />
                <span aria-hidden="true">to</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label="Highest price"
                  placeholder={facets.price ? String(facets.price.max) : "Max"}
                  value={maxText}
                  onChange={(event) => setMaxText(event.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(event) => event.key === "Enter" && commitPrice()}
                />
              </div>
            ) : null}
            {filtered ? (
              <button className="text-link" type="button" onClick={() => void go(keepSort)}>
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        <ul ref={gridRef} className="product-grid" aria-label="Products" hidden={cards.length === 0}>
          {cards.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={categoryNames[product.category] ?? ""}
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

        {hasMore ? (
          <div className="studio-load-more">
            <p>
              Showing {shownTo} of {total}
            </p>
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
                      category={category}
                      search={{ ...search, page: number > 1 ? number : undefined }}
                      aria-label={`Page ${number}`}
                      onClick={() => setRun({ signature, start: number, end: number })}
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

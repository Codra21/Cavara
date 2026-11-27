import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ListSearch } from "@/domain/product-listing";

const navigate = vi.hoisted(() => vi.fn());

const page = vi.hoisted(() => ({
  products: [{ id: 1, category: "tableware" }],
  categoryNames: { tableware: "Tableware" },
  category: null,
  total: 1,
  page: 1,
  pageCount: 1,
  pageSize: 12,
  facets: {
    categories: [{ id: "tableware", name: "Tableware", count: 1 }],
    price: { min: 150, max: 900 },
    availability: { all: 4, inStock: 3, preorder: 1 },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/query", () => ({
  listingQueryOptions: (query: object) => ({ queryKey: ["listing", query], queryFn: async () => page }),
  // CategoryLink looks categories up to link by current slug; none here, so links use the key as given.
  useCategories: () => ({ categories: [], categoryById: new Map(), imageBase: "" }),
}));
vi.mock("@/components/home/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: number } }) => <li>Product {product.id}</li>,
}));

const { ProductListing } = await import("@/components/shop/ProductListing");

async function renderListing(search: ListSearch = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ProductListing search={search} />
    </QueryClientProvider>,
  );
  await screen.findByRole("search");
  return view;
}

const lastSearch = () => navigate.mock.lastCall?.[0].search as ListSearch;
const filtersToggle = () => screen.getByRole("button", { name: /^Filters/ });
// css:false means the closed panel's `hidden` attribute applies; on desktop site.css shows it with display: contents.
const openFilters = (user: ReturnType<typeof userEvent.setup>) => user.click(filtersToggle());

beforeEach(() => {
  navigate.mockReset();
});

test("the search box is a labelled search input that keeps its id for the / hotkey", async () => {
  await renderListing();
  const box = screen.getByRole("searchbox", { name: "Search products" });
  expect(box.id).toBe("product-search");
  expect(box).toHaveProperty("type", "search");
  expect(box.getAttribute("maxlength")).toBe("80");
  expect(box.getAttribute("autocomplete")).toBe("off");
  expect(document.getElementById("product-search")).toBe(box);
});

test("Enter in the search box applies the text at once, and typing applies it after a pause", async () => {
  const user = userEvent.setup();
  await renderListing();
  const box = screen.getByRole("searchbox", { name: "Search products" });

  await user.type(box, "  bowl   set{Enter}");
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate.mock.lastCall?.[0]).toMatchObject({ to: "/products", replace: true });
  expect(lastSearch()).toEqual({ q: "bowl set" });

  navigate.mockClear();
  await user.type(box, "s");
  expect(navigate).not.toHaveBeenCalled();
  await waitFor(() => expect(lastSearch()).toEqual({ q: "bowl sets" }), { timeout: 2000 });
});

test("the search box shows the text from the URL", async () => {
  await renderListing({ q: "mug" });
  expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveProperty("value", "mug");
});

test("the price fields are named, show the facet range as placeholders and the URL values plainly", async () => {
  const user = userEvent.setup();
  await renderListing({ min: 1000, max: 12000 });
  await openFilters(user);
  const group = screen.getByRole("group", { name: "Price in taka" });
  const low = within(group).getByLabelText<HTMLInputElement>("Lowest price");
  const high = within(group).getByLabelText<HTMLInputElement>("Highest price");
  expect(low.value).toBe("1000");
  expect(high.value).toBe("12000");
  expect(low.getAttribute("inputmode")).toBe("numeric");
  expect(low.getAttribute("placeholder")).toBe("150");
  expect(high.getAttribute("placeholder")).toBe("900");
});

test("a price commits on blur and on Enter, and an untouched field commits nothing", async () => {
  const user = userEvent.setup();
  await renderListing({ max: 800 });
  await openFilters(user);
  const low = screen.getByLabelText("Lowest price");
  const high = screen.getByLabelText("Highest price");

  await user.type(low, "200");
  expect(navigate).not.toHaveBeenCalled();
  await user.tab();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(lastSearch()).toEqual({ min: 200, max: 800 });

  navigate.mockClear();
  await user.clear(high);
  await user.type(high, "700{Enter}");
  // The URL has not re-rendered with min yet; the second commit must keep it.
  expect(lastSearch()).toEqual({ min: 200, max: 700 });

  navigate.mockClear();
  await user.click(low);
  await user.tab();
  expect(navigate).not.toHaveBeenCalled();
});

test("clearing a price from the URL drops it", async () => {
  const user = userEvent.setup();
  await renderListing({ min: 300 });
  await openFilters(user);
  await user.clear(screen.getByLabelText("Lowest price"));
  await user.tab();
  expect(lastSearch()).toEqual({});
});

test("the Filters button starts closed, counts the active panel filters and opens the panel", async () => {
  const user = userEvent.setup();
  await renderListing({ availability: "in-stock", min: 200, sort: "newest" });
  const toggle = filtersToggle();
  expect(toggle.textContent).toBe("Filters3");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.className).toBe("button button-outline shop-filters-toggle");

  const panel = document.querySelector<HTMLElement>(".shop-filters-panel")!;
  expect(panel.hidden).toBe(false);
  expect(panel.classList.contains("is-open")).toBe(false);
  expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
  expect(panel.contains(screen.getByLabelText("Lowest price"))).toBe(true);

  await user.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel.classList.contains("is-open")).toBe(true);

  await user.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.classList.contains("is-open")).toBe(false);
});

test("the toggle and panel sit inside the .shop-filters root the CSS targets", async () => {
  await renderListing();
  const root = document.querySelector(".shop-filters")!;
  expect(root.querySelector(":scope > .shop-filters-bar > .shop-filters-toggle")).toBe(filtersToggle());
  expect(root.querySelector(":scope > .shop-filters-panel")).not.toBeNull();
});

test("sort and availability stay native selects that write the URL", async () => {
  const user = userEvent.setup();
  await renderListing({ availability: "preorder" });
  await openFilters(user);
  const sort = screen.getByRole("combobox", { name: "Sort" });
  const availability = screen.getByRole("combobox", { name: "Availability" });
  expect(availability).toHaveProperty("value", "preorder");

  await user.selectOptions(sort, "price-asc");
  expect(lastSearch()).toEqual({ availability: "preorder", sort: "price-asc" });

  await user.selectOptions(availability, "");
  expect(lastSearch()).toEqual({});
});

test("an agent can find and drive the search and price controls", async () => {
  const agent = createAgent();
  await renderListing();

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const labels = components.map((entry) => entry.label);
  for (const label of ["Search products", "Lowest price", "Highest price"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }

  const result = await agent.act({
    steps: [
      { ref: "Search products", action: "setValue", args: ["jar"] },
      { ref: "Lowest price", action: "setValue", args: [250] },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveProperty("value", "jar");
  expect(screen.getByLabelText<HTMLInputElement>("Lowest price").value).toBe("250");
  await waitFor(() => expect(navigate).toHaveBeenCalled(), { timeout: 2000 });
});

test("a price over MAX_PRICE is clamped and never silently dropped while staying in the input", async () => {
  const user = userEvent.setup();
  await renderListing();
  await openFilters(user);
  const high = screen.getByLabelText("Highest price") as HTMLInputElement;

  await user.type(high, "99999999");
  await user.tab();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(lastSearch().max).toBe(10_000_000);
  expect(high.value).toBe("10000000");
});

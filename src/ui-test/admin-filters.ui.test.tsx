import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyTotals } from "@/domain/dashboard";

const navigate = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));
const listOrdersFn = vi.hoisted(() => vi.fn());
const getDashboardFn = vi.hoisted(() => vi.fn());
const listAdminProductsFn = vi.hoisted(() => vi.fn());
const countAdminProductsFn = vi.hoisted(() => vi.fn());
const listAdminCategoriesFn = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  getRouteApi: () => ({ useSearch: () => route.search }),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/server/functions/admin-orders.functions", () => ({ listOrdersFn }));
vi.mock("@/server/functions/admin-blocked-phones.functions", () => ({}));
vi.mock("@/server/functions/admin-stock.functions", () => ({}));
vi.mock("@/server/functions/admin-discounts.functions", () => ({}));
vi.mock("@/server/functions/admin-auth.functions", () => ({}));
vi.mock("@/server/functions/admin-dashboard.functions", () => ({ getDashboardFn }));
vi.mock("@/server/functions/admin-catalog.functions", () => ({
  listAdminProductsFn,
  countAdminProductsFn,
  listAdminCategoriesFn,
  listProductNamesFn: vi.fn(async () => []),
  getAdminProductFn: vi.fn(),
  bulkProductActionFn: vi.fn(),
  duplicateProductFn: vi.fn(),
}));

const { DashboardPanel } = await import("@/components/admin/DashboardPanel");
const { OrderList } = await import("@/components/admin/OrderList");
const { ProductList } = await import("@/components/admin/ProductList");

function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  navigate.mockReset();
  route.search = {};
  listOrdersFn.mockReset().mockResolvedValue({ orders: [], next: null });
  getDashboardFn.mockReset().mockResolvedValue({
    today: emptyTotals("2026-11-24"),
    yesterday: emptyTotals("2026-11-23"),
    thisMonth: emptyTotals("2026-11"),
    lastMonth: emptyTotals("2026-10"),
    days: [emptyTotals("2026-11-24")],
    months: [emptyTotals("2026-11")],
    alerts: { pending: 0, failed: 0, configured: true },
  });
  listAdminProductsFn.mockReset().mockResolvedValue({ products: [], next: null, prev: null });
  countAdminProductsFn.mockReset().mockResolvedValue({ all: 9, published: 5, draft: 3, archived: 1 });
  listAdminCategoriesFn.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

const checked = (name: string) =>
  screen.getByRole("radio", { name: new RegExp(`^${name}`) }).getAttribute("aria-checked");
const lastSearch = () => (navigate.mock.calls.at(-1)![0] as { search: Record<string, unknown> }).search;

test("the dashboard period control switches between days and months", async () => {
  const user = userEvent.setup();
  render(<DashboardPanel />, { wrapper: Providers });

  await screen.findByRole("radiogroup", { name: "Period" });
  expect(checked("Days")).toBe("true");
  expect(screen.getByText("Last 30 days")).toBeTruthy();

  await user.click(screen.getByRole("radio", { name: /^Months/ }));
  expect(checked("Months")).toBe("true");
  expect(checked("Days")).toBe("false");
  expect(screen.getByText("Last 12 months")).toBeTruthy();

  screen.getByRole("radio", { name: /^Months/ }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(checked("Days")).toBe("true");
});

test("the order status filter queries the chosen status", async () => {
  const user = userEvent.setup();
  render(<OrderList />, { wrapper: Providers });

  const group = screen.getByRole("radiogroup", { name: "Filter by status" });
  expect(group.hasAttribute("data-disabled")).toBe(false);
  expect(checked("New")).toBe("true");
  await waitFor(() =>
    expect(listOrdersFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "new" }) }),
    ),
  );

  await user.click(screen.getByRole("radio", { name: "Delivered" }));
  expect(checked("Delivered")).toBe("true");
  await waitFor(() =>
    expect(listOrdersFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "delivered" }) }),
    ),
  );
});

test("the order status filter is disabled and shows no selection while a search is active", async () => {
  const user = userEvent.setup();
  render(<OrderList />, { wrapper: Providers });

  await user.type(screen.getByRole("searchbox", { name: "Search orders by phone number or reference" }), "01712345678");
  const group = screen.getByRole("radiogroup", { name: "Filter by status" });
  await waitFor(() => expect(group.hasAttribute("data-disabled")).toBe(true), { timeout: 3000 });
  for (const item of screen.getAllByRole("radio")) {
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(item.hasAttribute("data-disabled")).toBe(true);
  }
  expect(screen.getByText("Searching every status.")).toBeTruthy();

  await user.click(screen.getByRole("radio", { name: "Delivered" }));
  expect(screen.getByRole("radio", { name: "Delivered" }).getAttribute("aria-checked")).toBe("false");
});

test("the product status filter keeps its counts and navigates with the chosen status", async () => {
  const user = userEvent.setup();
  route.search = { status: "draft" };
  render(<ProductList />, { wrapper: Providers });

  const draft = await screen.findByRole("radio", { name: /^Draft\s*3$/ });
  expect(draft.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: /^All\s*9$/ }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("radio", { name: /^Published\s*5$/ })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^Archived\s*1$/ })).toBeTruthy();

  await user.click(screen.getByRole("radio", { name: /^Published/ }));
  expect(navigate).toHaveBeenLastCalledWith({
    to: "/admin/products",
    search: expect.objectContaining({ status: "published" }),
  });

  await user.click(screen.getByRole("radio", { name: /^All/ }));
  expect(lastSearch().status).toBeUndefined();
});

test("the stock toggles follow the search params and flip them on press", async () => {
  const user = userEvent.setup();
  route.search = { outOfStock: true };
  render(<ProductList />, { wrapper: Providers });

  const out = await screen.findByRole("button", { name: "Out of stock" });
  const low = screen.getByRole("button", { name: "Low stock" });
  expect(out.getAttribute("aria-pressed")).toBe("true");
  expect(low.getAttribute("aria-pressed")).toBe("false");
  expect(out.hasAttribute("data-pressed")).toBe(true);
  expect(low.hasAttribute("data-pressed")).toBe(false);
  expect(low.hasAttribute("aria-disabled")).toBe(false);

  await user.click(out);
  expect(lastSearch().outOfStock).toBeUndefined();

  await user.click(low);
  expect(navigate).toHaveBeenLastCalledWith({
    to: "/admin/products",
    search: expect.objectContaining({ lowStock: true, outOfStock: true }),
  });

  low.focus();
  await user.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledTimes(3);
});

test("an agent can find and change every filter", async () => {
  const agent = createAgent();
  render(
    <>
      <DashboardPanel />
      <ProductList />
    </>,
    { wrapper: Providers },
  );
  await screen.findByRole("radiogroup", { name: "Period" });
  await screen.findByRole("button", { name: "Low stock" });

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const labels = components.map((entry) => entry.label);
  for (const label of ["Period", "Filter by status", "Out of stock", "Low stock"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }

  const result = await agent.act({
    steps: [
      { ref: "Period", action: "setValue", args: ["Months"] },
      { ref: "Filter by status", action: "setValue", args: ["Draft 3"] },
      { ref: "Out of stock", action: "toggle" },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(screen.getByText("Last 12 months")).toBeTruthy();
  expect(navigate).toHaveBeenCalledWith({
    to: "/admin/products",
    search: expect.objectContaining({ status: "draft" }),
  });
  expect(navigate).toHaveBeenCalledWith({
    to: "/admin/products",
    search: expect.objectContaining({ outOfStock: true }),
  });
});

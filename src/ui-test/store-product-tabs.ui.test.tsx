import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, expect, test, vi } from "vitest";
import type { PublicProduct } from "@/domain/catalog-snapshot";

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => <a href={to}>{children as never}</a>,
}));
vi.mock("@/lib/query", () => ({
  lookupIds: () => [],
  productsByIdsQueryOptions: () => ({}),
  relatedQueryOptions: () => ({}),
}));
vi.mock("@/components/store/useOpenProduct", () => ({ useOpenProduct: () => vi.fn() }));
vi.mock("@/components/store/StoreProvider", () => ({
  useStore: () => ({
    selectedVariant: () => 0,
    selectVariant: vi.fn(),
    addToBag: () => true,
    showToast: vi.fn(),
    openBag: vi.fn(),
    recent: [],
    rememberViewed: vi.fn(),
  }),
}));

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

const { ProductPage } = await import("@/components/product/ProductPage");

const product: PublicProduct = {
  id: 1,
  slug: "cup",
  name: "Polka Cup",
  category: "cups",
  price: 450,
  regularPrice: null,
  featured: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  summary: "A cup for tea.",
  details: ["Stoneware"],
  note: null,
  variants: [{ name: "Red", swatch: "#c00", availability: "in_stock", images: ["/a.jpg", "/b.jpg"] }],
};

const shown = () => screen.getAllByRole("tabpanel", { hidden: true }).filter((panel) => !panel.hasAttribute("hidden"));

function renderPage() {
  render(<ProductPage product={product} category={{ id: "cups", name: "Cups" } as never} />);
}

afterEach(cleanup);

test("the three tabs render with the first selected and exactly one tabbable", () => {
  renderPage();
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Description", "Additional information", "Ordering & delivery"]);
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[0]]);
  expect(screen.getByRole("tablist", { name: "Product information" }).classList.contains("pdp-tablist")).toBe(true);
  expect(shown()).toHaveLength(1);
  expect(shown()[0]?.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
});

test("arrow keys, Home and End move focus, select and show the right panel", async () => {
  const user = userEvent.setup();
  renderPage();
  const [description, information, ordering] = screen.getAllByRole("tab");
  await waitFor(() => expect(document.activeElement?.id).toBe("pdp-title"));
  description!.focus();

  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(information);
  expect(information!.getAttribute("aria-selected")).toBe("true");
  expect(information!.hasAttribute("data-selected")).toBe(true);
  expect(shown()[0]?.querySelector("table")).not.toBeNull();
  expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toEqual([information]);

  await user.keyboard("{End}");
  expect(document.activeElement).toBe(ordering);
  expect(shown()[0]?.textContent).toContain("How ordering works");

  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(description);
  expect(description!.getAttribute("aria-selected")).toBe("true");

  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(ordering);

  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(description);
  expect(shown()[0]?.textContent).toContain("About this piece");
  expect(shown()).toHaveLength(1);
});

test("clicking a tab selects it", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("tab", { name: "Ordering & delivery" }));
  expect(screen.getByRole("tab", { name: "Ordering & delivery" }).getAttribute("aria-selected")).toBe("true");
  expect(shown()[0]?.textContent).toContain("Questions before you order?");
});

test("hidden panels stay in the page for crawlers", () => {
  renderPage();
  expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
  expect(document.body.textContent).toContain("How ordering works");
});

test("an agent can find and select every tab", async () => {
  const agent = createAgent();
  renderPage();

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const tabs = components.find((entry) => entry.component === "tabs");
  expect(tabs, "tabs missing from the snapshot").toBeTruthy();
  expect(components.map((entry) => entry.label)).toContain("Product information");

  const result = await agent.act({
    steps: [{ ref: "Product information", action: "setValue", args: ["Ordering & delivery"] }],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(screen.getByRole("tab", { name: "Ordering & delivery" }).getAttribute("aria-selected")).toBe("true");
  expect(shown()[0]?.textContent).toContain("How ordering works");
});

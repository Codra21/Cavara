import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const openBag = vi.hoisted(() => vi.fn());
const openProduct = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
}));
vi.mock("@/components/store/StoreProvider", () => ({
  useStore: () => ({ theme: "light", toggleTheme: vi.fn(), bagCount: 0, bagBump: 0, openBag }),
}));
vi.mock("@/components/layout/useShopNavigation", () => ({ useShopNavigation: () => vi.fn() }));
vi.mock("@/components/store/useOpenProduct", () => ({ useOpenProduct: () => openProduct }));
const listProductsFn = vi.hoisted(() => vi.fn(async () => ({ products: [] as unknown[], total: 0 })));
vi.mock("@/server/functions/catalog.functions", () => ({ listProductsFn }));
vi.mock("@/lib/query", () => ({ useHome: () => ({}), useCategories: () => ({ imageBase: "" }) }));

const { GlobalEffects } = await import("@/components/layout/GlobalEffects");
const { QuickDock } = await import("@/components/layout/SiteChrome");
const { SiteHeader } = await import("@/components/layout/SiteHeader");
const { Swatch, SwatchGroup } = await import("@/components/ui/primitives");

beforeEach(() => {
  openBag.mockClear();
  openProduct.mockClear();
});

const menuToggle = () => screen.getByRole("button", { name: /menu$/i });

test("the mobile menu toggle names its panel and the panel opens and closes", async () => {
  const user = userEvent.setup();
  render(<SiteHeader />);
  expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();

  await user.click(menuToggle());
  expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
  expect(menuToggle().getAttribute("aria-controls")).toBe(screen.getByRole("dialog").id);
  expect(screen.getByRole("navigation", { name: "Mobile" })).toBeTruthy();
  expect(menuToggle().textContent).toBe("Close menu");

  await user.click(menuToggle());
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
});

test("Escape closes the mobile menu and focus stays on the toggle", async () => {
  const user = userEvent.setup();
  render(<SiteHeader />);
  await user.click(menuToggle());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
  expect(document.activeElement).toBe(menuToggle());
});

test("a press outside the header closes the mobile menu", async () => {
  const user = userEvent.setup();
  render(
    <>
      <SiteHeader />
      <button type="button">Elsewhere</button>
    </>,
  );
  await user.click(menuToggle());
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
});

test("choosing a mobile menu link closes the menu", async () => {
  const user = userEvent.setup();
  render(<SiteHeader />);
  await user.click(menuToggle());
  const nav = screen.getByRole("navigation", { name: "Mobile" });
  const link = nav.querySelector("a[href='/products']") as HTMLAnchorElement;
  link.addEventListener("click", (event) => event.preventDefault());
  await user.click(link);
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
  expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
});

const colours = [
  { name: "Sage", swatch: "#9caf88", availability: "in_stock" as const },
  { name: "Honey", swatch: "#e0a458", availability: "out_of_stock" as const },
  { name: "Slate", swatch: "#5b6770", availability: "in_stock" as const },
];

function Picker({ onPick = () => {} }: { onPick?: (name: string) => void }) {
  const [value, setValue] = useState("Sage");
  return (
    <SwatchGroup
      label="Choose a colour"
      className="pdp-swatches"
      value={value}
      onValueChange={(name) => {
        setValue(name);
        onPick(name);
      }}
    >
      {colours.map((item) => (
        <Swatch key={item.name} variant={item} size="large" />
      ))}
      <button type="button" className="swatch-more">
        +2
      </button>
    </SwatchGroup>
  );
}

test("swatches are one radio group with the chosen colour checked", () => {
  const { container } = render(<Picker />);
  expect(screen.getByRole("radiogroup", { name: "Choose a colour" })).toBeTruthy();
  const radios = screen.getAllByRole("radio");
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(["Sage", "Honey, out of stock", "Slate"]);
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  expect(container.querySelectorAll(".swatch[data-checked]")).toHaveLength(1);
  expect(radios[1]?.hasAttribute("data-sold-out")).toBe(true);
  expect(radios[1]?.getAttribute("title")).toBe("Honey (out of stock)");
  expect(radios[0]?.getAttribute("data-swatch-size")).toBe("large");
});

test("a sold-out colour can still be chosen", async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Picker onPick={onPick} />);
  await user.click(screen.getByRole("radio", { name: "Honey, out of stock" }));
  expect(onPick).toHaveBeenCalledWith("Honey");
  expect(screen.getByRole("radio", { name: "Honey, out of stock" }).getAttribute("aria-checked")).toBe("true");
});

test("arrow keys move the selection between swatches and wrap", async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Picker onPick={onPick} />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Sage" }));
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Honey, out of stock" }));
  expect(onPick).toHaveBeenLastCalledWith("Honey");
  await user.keyboard("{ArrowDown}{ArrowRight}");
  expect(onPick).toHaveBeenLastCalledWith("Sage");
  await user.keyboard("{ArrowLeft}");
  expect(onPick).toHaveBeenLastCalledWith("Slate");
});

test("the group is one tab stop and the +N button follows it", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "+2" }));
});

test("an agent can find the header menu and the colour group", async () => {
  const agent = createAgent();
  render(
    <>
      <SiteHeader />
      <Picker />
    </>,
  );
  const entries = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of entries) expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  const labels = entries.map((entry) => entry.label);
  expect(labels, "Choose a colour is missing from the snapshot").toContain("Choose a colour");
  expect(labels.some((label) => /menu/i.test(label ?? ""))).toBe(true);

  const result = await agent.act({
    steps: [{ ref: "Choose a colour", action: "setValue", args: ["Slate"] }],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(screen.getByRole("radio", { name: "Slate" }).getAttribute("aria-checked")).toBe("true");
});

test("QuickDock Home link scrolls to the top instead of relying on the sticky #top header", async () => {
  const user = userEvent.setup();
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<QuickDock />);

  const home = screen.getByRole("link", { name: "Home" });
  expect(home.getAttribute("href")).toBe("/");
  await user.click(home);
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  scrollTo.mockRestore();
});

test("GlobalEffects removes .media-failed when a replacement image loads", () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const { container } = render(
    <>
      <GlobalEffects />
      <div className="product-media">
        <img alt="Mug" src="/media/broken.webp" />
      </div>
    </>,
  );
  const wrapper = container.querySelector(".product-media")!;
  const img = container.querySelector("img")!;

  img.dispatchEvent(new Event("error"));
  expect(wrapper.classList.contains("media-failed")).toBe(true);

  img.dispatchEvent(new Event("load"));
  expect(wrapper.classList.contains("media-failed")).toBe(false);
});

test("GlobalEffects keeps .media-failed while another image in the same wrapper is still broken", () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const { container } = render(
    <>
      <GlobalEffects />
      <div className="product-media">
        <img alt="Mug" src="/media/broken.webp" />
        <img alt="" src="/media/hover.webp" />
      </div>
    </>,
  );
  const wrapper = container.querySelector(".product-media")!;
  const [main, hover] = Array.from(container.querySelectorAll("img"));

  main!.dispatchEvent(new Event("error"));
  hover!.dispatchEvent(new Event("load"));
  expect(wrapper.classList.contains("media-failed")).toBe(true);

  main!.dispatchEvent(new Event("load"));
  expect(wrapper.classList.contains("media-failed")).toBe(false);
});

test("header search icon expands the search bar and displays matching dropdown results", async () => {
  listProductsFn.mockReset().mockResolvedValue({
    products: [
      {
        id: 1,
        slug: "polka-cup",
        name: "Polka Cup",
        category: "drinkware",
        price: 950,
        regularPrice: null,
        sale: null,
        featured: false,
        createdAt: "2026-11-01T00:00:00Z",
        images: ["/media/cup.webp"],
        variants: [{ name: "White", swatch: "#fff", availability: "in_stock", image: "/media/cup.webp" }],
      },
    ],
    total: 1,
  });
  const user = userEvent.setup();
  render(<SiteHeader />);

  await user.click(screen.getAllByRole("button", { name: "Search products" })[0]!);
  const input = screen.getByRole("searchbox", { name: "Search products" });
  await user.type(input, "Polka");
  expect(await screen.findByText("Polka Cup")).toBeTruthy();
});

test("pressing the header search icon again closes the search bar instead of reopening it", async () => {
  const user = userEvent.setup();
  render(<SiteHeader />);
  const icon = () => screen.getAllByRole("button", { name: "Search products" })[1]!;

  await user.click(icon());
  expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search products" }));
  expect(icon().getAttribute("aria-expanded")).toBe("true");

  await user.click(icon());
  expect(screen.queryByRole("searchbox", { name: "Search products" })).toBeNull();
  expect(icon().getAttribute("aria-expanded")).toBe("false");
});

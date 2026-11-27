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
}));
vi.mock("@/components/store/StoreProvider", () => ({
  useStore: () => ({ theme: "light", toggleTheme: vi.fn(), bagCount: 0, bagBump: 0, openBag }),
}));
vi.mock("@/components/layout/useShopNavigation", () => ({ useShopNavigation: () => vi.fn() }));
vi.mock("@/components/store/useOpenProduct", () => ({ useOpenProduct: () => openProduct }));
vi.mock("@/lib/query", () => ({ useHome: () => ({ lookbook: null }), useCategories: () => ({ imageBase: "" }) }));

const { QuickDock } = await import("@/components/layout/SiteChrome");
const { SiteHeader } = await import("@/components/layout/SiteHeader");
const { LookbookSpot } = await import("@/components/home/HomeSections");
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

const lookbookProduct = {
  id: 5,
  name: "Breakfast dish",
  price: 1200,
  images: ["/dish.webp"],
  variants: [
    { name: "Sage", swatch: "#9caf88", availability: "in_stock", image: "/sage.webp" },
    { name: "Honey", swatch: "#e0a458", availability: "in_stock", image: "/honey.webp" },
  ],
} as unknown as Parameters<typeof LookbookSpot>[0]["product"];

function renderSpot() {
  return render(
    <>
      <LookbookSpot product={lookbookProduct} spot={{ variant: 1, x: 21, y: 70 }} />
      <button type="button">Elsewhere</button>
    </>,
  );
}

const marker = () => screen.getByRole("button", { name: "Breakfast dish, Honey" });

test("a lookbook marker opens its product card, and a second press closes it", async () => {
  const user = userEvent.setup();
  const { container } = renderSpot();
  expect(marker().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("dialog")).toBeNull();

  await user.click(marker());
  expect(marker().getAttribute("aria-expanded")).toBe("true");
  const card = screen.getByRole("dialog", { name: "Breakfast dish" });
  expect(marker().getAttribute("aria-controls")).toBe(card.id);
  expect(card.textContent).toContain("Honey");
  expect(container.querySelector(".studio-spot.is-start.is-bottom.is-open")).toBeTruthy();
  expect(container.querySelector(".studio-spot")?.getAttribute("style")).toContain("--x: 21%");

  await user.click(marker());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(container.querySelector(".is-open")).toBeNull();
});

test("Escape and an outside press close a lookbook card, with focus on the marker", async () => {
  const user = userEvent.setup();
  renderSpot();
  await user.click(marker());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(marker());

  await user.click(marker());
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a lookbook card opens the piece", async () => {
  const user = userEvent.setup();
  renderSpot();
  await user.click(marker());
  await user.click(screen.getByRole("button", { name: "View piece" }));
  expect(openProduct).toHaveBeenCalledWith(lookbookProduct, 1);
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

test("an agent can find the header menu, a lookbook marker and the colour group", async () => {
  const agent = createAgent();
  render(
    <>
      <SiteHeader />
      <LookbookSpot product={lookbookProduct} spot={{ variant: 1, x: 50, y: 20 }} />
      <Picker />
    </>,
  );
  const entries = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of entries) expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  const labels = entries.map((entry) => entry.label);
  for (const label of ["Choose a colour", "Breakfast dish, Honey"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }
  expect(labels.some((label) => /menu/i.test(label ?? ""))).toBe(true);

  const result = await agent.act({
    steps: [
      { ref: "Choose a colour", action: "setValue", args: ["Slate"] },
      { ref: "Breakfast dish, Honey", action: "open" },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(screen.getByRole("radio", { name: "Slate" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("dialog", { name: "Breakfast dish" })).toBeTruthy();
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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

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
  useStore: () => ({ theme: "light", toggleTheme: vi.fn(), bagCount: 0, bagBump: 0, openBag: vi.fn() }),
}));
vi.mock("@/components/layout/useShopNavigation", () => ({ useShopNavigation: () => vi.fn() }));
vi.mock("@/components/store/useOpenProduct", () => ({ useOpenProduct: () => vi.fn() }));
vi.mock("@/server/functions/catalog.functions", () => ({
  listProductsFn: vi.fn(async () => ({ products: [] as unknown[], total: 0 })),
}));
vi.mock("@/lib/query", () => ({ useHome: () => ({}), useCategories: () => ({ imageBase: "" }) }));

const { SiteHeader } = await import("@/components/layout/SiteHeader");

test("mobile nav traps Tab focus inside .mobile-nav and restores focus to .menu-toggle on Escape", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <SiteHeader />
      <main>
        <a href="/featured">Featured item</a>
        <button type="button">Main action</button>
      </main>
    </>,
  );

  const toggle = screen.getByRole("button", { name: /menu$/i });
  const main = container.querySelector("main")!;

  await user.click(toggle);
  const mobileNav = container.querySelector(".mobile-nav")!;
  const nav = screen.getByRole("navigation", { name: "Mobile" });
  const links = Array.from(nav.querySelectorAll("a"));
  expect(links.length).toBeGreaterThan(1);
  expect(document.activeElement).toBe(links[0]);

  for (let i = 1; i <= links.length + 1; i++) {
    await user.tab();
    expect(mobileNav.contains(document.activeElement)).toBe(true);
    expect(main.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(links[i % links.length]);
  }

  await user.tab({ shift: true });
  expect(mobileNav.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(links[0]);

  await user.tab({ shift: true });
  expect(mobileNav.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(links[links.length - 1]);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
  expect(document.activeElement).toBe(toggle);
});

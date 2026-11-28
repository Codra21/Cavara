import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StoreProvider } from "@/components/store/StoreProvider";
import type { ProductCard as Card } from "@/domain/catalog-snapshot";

const products: Card[] = [
  {
    id: 101,
    slug: "glazed-vase",
    name: "Glazed Vase",
    category: "tableware",
    price: 2400,
    regularPrice: null,
    featured: false,
    createdAt: "2026-11-01",
    images: ["/images/vase-1.webp"],
    variants: [{ name: "Sand", swatch: "#d8c8b0", availability: "preorder", image: "/images/vase-1.webp" }],
    sale: null,
  },
  {
    id: 102,
    slug: "linen-runner",
    name: "Linen Runner",
    category: "tableware",
    price: 1800,
    regularPrice: null,
    featured: false,
    createdAt: "2026-11-02",
    images: ["/images/runner-1.webp"],
    variants: [{ name: "Oat", swatch: "#e5dccb", availability: "preorder", image: "/images/runner-1.webp" }],
    sale: null,
  },
];

const listingPage = {
  products,
  categoryNames: { tableware: "Tableware" },
  category: null,
  total: products.length,
  page: 1,
  pageCount: 1,
  pageSize: 24,
  facets: {
    categories: [{ id: "tableware", name: "Tableware", count: products.length }],
    price: { min: 1800, max: 2400 },
    availability: { all: products.length, inStock: 0, preorder: products.length },
  },
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/query", () => ({
  listingQueryOptions: (query: object) => ({
    queryKey: ["listing", query],
    queryFn: async () => listingPage,
  }),
}));

const { Route } = await import("@/routes/pre-order");
const PreOrderPage = Route.options.component as ComponentType;

function makeTree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["listing", { availability: "preorder" }], listingPage);
  return (
    <QueryClientProvider client={client}>
      <StoreProvider>
        <PreOrderPage />
      </StoreProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("PreOrderPage client render produces zero nested <li> elements and zero console errors", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = render(makeTree());

  expect(screen.getByRole("heading", { level: 1, name: "Pre-order" })).toBeTruthy();
  expect(container.querySelectorAll("li li")).toHaveLength(0);
  expect(container.querySelectorAll("ul.product-grid > li.product-card")).toHaveLength(products.length);
  expect(errorSpy).not.toHaveBeenCalled();
});

test("PreOrderPage SSR and React 19 hydration produce zero nested <li> elements and zero hydration errors", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const recoverableErrors: unknown[] = [];

  const html = renderToString(makeTree());

  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = html;

  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, makeTree(), {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(html).not.toMatch(/<li\b[^>]*>\s*<li\b/);
    expect(container.querySelectorAll("li li")).toHaveLength(0);
    expect(container.querySelectorAll("ul.product-grid > li.product-card")).toHaveLength(products.length);
  } finally {
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
});

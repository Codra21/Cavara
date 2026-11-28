import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PublicProduct } from "@/domain/catalog-snapshot";
import { StoreProvider } from "@/components/store/StoreProvider";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search, ...rest }: { children: React.ReactNode; search?: Record<string, unknown> }) => (
    <a data-search={JSON.stringify(search ?? {})} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/lib/query", () => ({
  lookupIds: (ids: number[]) => ids,
  productsByIdsQueryOptions: () => ({ queryKey: ["ids"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
  relatedQueryOptions: () => ({ queryKey: ["related"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
  useCategories: () => ({ categories: [], categoryById: new Map(), imageBase: "" }),
}));

const { ProductPage } = await import("@/components/product/ProductPage");

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const preorderProduct: PublicProduct = {
  id: 42,
  slug: "hand-thrown-vase",
  name: "Hand-Thrown Vase",
  category: "decor",
  price: 2400,
  regularPrice: null,
  sale: null,
  summary: "Stoneware vase",
  details: ["24 cm tall"],
  note: null,
  featured: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  variants: [
    { name: "Sand", swatch: "#d8cbb8", availability: "preorder", images: ["/media/vase-sand.webp"] },
    { name: "Slate", swatch: "#4a5568", availability: "out_of_stock", images: ["/media/vase-slate.webp"] },
  ],
};

function renderScrolledProduct(initialVariant?: number) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: -120,
    bottom: -40,
    left: 0,
    right: 320,
    width: 320,
    height: 80,
    x: 0,
    y: -120,
    toJSON: () => ({}),
  });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage
          product={preorderProduct}
          category={{ id: "decor", name: "Decor", description: "", image: "" }}
          initialVariant={initialVariant}
        />
      </StoreProvider>
    </QueryClientProvider>,
  );
}

test("sticky buy bar renders a working WhatsApp pre-order link on a preorder variant", () => {
  const { container } = renderScrolledProduct(0);
  const stickyBar = container.querySelector<HTMLElement>(".pdp-bar");
  expect(stickyBar).toBeTruthy();

  const bar = within(stickyBar!);
  expect(bar.queryByRole("button")).toBeNull();

  const link = bar.getByRole("link", { name: /Request on WhatsApp/i });
  const href = link.getAttribute("href") ?? "";
  expect(href).toMatch(/^https:\/\/wa\.me\//);
  expect(decodeURIComponent(href)).toContain("Hand-Thrown Vase");
  expect(decodeURIComponent(href)).toContain("Sand");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");

  const mainPreorderLink = container.querySelector<HTMLAnchorElement>(".pdp-preorder a");
  expect(mainPreorderLink?.getAttribute("href")).toBe(href);
});

test("sticky buy bar keeps out_of_stock variants disabled as a button", () => {
  const { container } = renderScrolledProduct(1);
  const stickyBar = container.querySelector<HTMLElement>(".pdp-bar");
  expect(stickyBar).toBeTruthy();

  const bar = within(stickyBar!);
  expect(bar.queryByRole("link")).toBeNull();

  const button = bar.getByRole("button", { name: /Sold out/i });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

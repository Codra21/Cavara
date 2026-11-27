import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PublicProduct } from "@/domain/catalog-snapshot";
import { StoreProvider, useStore } from "@/components/store/StoreProvider";
import { STORAGE_KEYS } from "@/lib/config";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/lib/query", () => ({
  lookupIds: (ids: number[]) => ids,
  productsByIdsQueryOptions: () => ({ queryKey: ["ids"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
  relatedQueryOptions: () => ({ queryKey: ["related"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
}));

const { ProductPage } = await import("@/components/product/ProductPage");

const product: PublicProduct = {
  id: 1,
  slug: "polka-cup",
  name: "Polka Cup",
  category: "drinkware",
  price: 950,
  regularPrice: null,
  sale: null,
  summary: "Ceramic cup",
  details: ["250 ml"],
  note: null,
  featured: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  variants: [
    { name: "Off-white", swatch: "#f5f5f0", availability: "in_stock" as const, images: ["/media/a.webp"] },
    { name: "Crimson", swatch: "#8b1e24", availability: "in_stock" as const, images: ["/media/b.webp"] },
  ],
};

test("ProductPage honours initialVariant on SSR before client effects run", () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage
          product={product}
          category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }}
          initialVariant={1}
        />
      </StoreProvider>
    </QueryClientProvider>,
  );
  expect(html).toContain("<strong>Crimson</strong>");
  expect(html).toContain("/media/b.webp");
});

test("rememberViewed on initial mount preserves previously stored recently-viewed products", () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify([10, 20]));
  function Viewer({ id }: { id: number }) {
    const { rememberViewed } = useStore();
    useEffect(() => {
      rememberViewed(id);
    }, [id, rememberViewed]);
    return null;
  }
  render(
    <StoreProvider>
      <Viewer id={30} />
    </StoreProvider>,
  );
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) ?? "[]")).toEqual([30, 10, 20]);
});

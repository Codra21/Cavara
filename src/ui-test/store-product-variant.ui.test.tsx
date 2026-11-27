import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PublicProduct } from "@/domain/catalog-snapshot";
import { StoreProvider } from "@/components/store/StoreProvider";

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

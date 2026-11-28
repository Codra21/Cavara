import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { StoreProvider } from "@/components/store/StoreProvider";
import type { PublicProduct } from "@/domain/catalog-snapshot";

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

afterEach(cleanup);

const multiPhotoProduct: PublicProduct = {
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
    {
      name: "Off-white",
      swatch: "#f5f5f0",
      availability: "in_stock",
      images: ["/media/a1.webp", "/media/a2.webp", "/media/a3.webp"],
    },
  ],
};

test("ProductPage gallery thumbnails keep native button semantics inside listitems and update aria-current", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });

  const queryClient = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage
          product={multiPhotoProduct}
          category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }}
        />
      </StoreProvider>
    </QueryClientProvider>,
  );

  const thumbList = screen.getByRole("list", { name: "Product thumbnails" });
  const listItems = within(thumbList).getAllByRole("listitem");
  expect(listItems).toHaveLength(3);

  for (const item of listItems) {
    expect(item.tagName).not.toBe("BUTTON");
  }

  const thumbButtons = within(thumbList).getAllByRole("button");
  expect(thumbButtons).toHaveLength(3);

  const [btn1, btn2, btn3] = thumbButtons;
  expect(btn1?.getAttribute("role")).toBeNull();
  expect(btn1?.getAttribute("aria-label")).toBe("Photo 1 of 3");
  expect(btn1?.getAttribute("aria-current")).toBe("true");
  expect(btn2?.getAttribute("aria-current")).toBeNull();
  expect(btn3?.getAttribute("aria-current")).toBeNull();

  await user.click(btn2!);
  expect(btn1?.getAttribute("aria-current")).toBeNull();
  expect(btn2?.getAttribute("aria-current")).toBe("true");
  expect(btn3?.getAttribute("aria-current")).toBeNull();
  expect(screen.getByAltText("Polka Cup, Off-white, photo 2 of 3").getAttribute("src")).toBe("/media/a2.webp");
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { PublicProduct } from "@/domain/catalog-snapshot";
import { StoreProvider, useStore } from "@/components/store/StoreProvider";
import { STORAGE_KEYS } from "@/lib/config";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search, ...rest }: { children: React.ReactNode; search?: Record<string, unknown> }) => (
    <a data-search={JSON.stringify(search ?? {})} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));
vi.mock("@/lib/query", () => ({
  lookupIds: (ids: number[]) => ids,
  productsByIdsQueryOptions: () => ({ queryKey: ["ids"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
  relatedQueryOptions: () => ({ queryKey: ["related"], queryFn: async () => ({ products: [], categoryNames: {} }) }),
  // CategoryLink looks categories up to link by current slug; none here, so links use the key as given.
  useCategories: () => ({ categories: [], categoryById: new Map(), imageBase: "" }),
}));

const { ProductPage } = await import("@/components/product/ProductPage");
const { Toast } = await import("@/components/layout/SiteChrome");
const { ProductCard } = await import("@/components/home/ProductCard");

afterEach(cleanup);

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

test("adding to bag when already at MAX_QTY shows a max-limit toast instead of claiming items were added", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  localStorage.setItem(STORAGE_KEYS.bag, JSON.stringify([{ id: 1, variant: 0, qty: 20 }]));
  const queryClient = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage product={product} category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }} />
        <Toast />
      </StoreProvider>
    </QueryClientProvider>,
  );

  await user.click(screen.getAllByRole("button", { name: "Add to cart" })[0]!);
  expect(screen.getByText(/maximum 20 per colour/i)).toBeTruthy();
  expect(screen.queryByText(/1 item added/i)).toBeNull();
});

test("ProductCard links carry ?variant=N when a non-default colour swatch is selected", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const user = userEvent.setup();
  const card = {
    id: 1,
    slug: "polka-cup",
    name: "Polka Cup",
    category: "drinkware",
    price: 950,
    regularPrice: null,
    sale: null,
    featured: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    images: ["/media/a.webp"],
    variants: [
      { name: "Off-white", swatch: "#f5f5f0", availability: "in_stock" as const, image: "/media/a.webp" },
      { name: "Crimson", swatch: "#8b1e24", availability: "in_stock" as const, image: "/media/b.webp" },
    ],
  };
  render(
    <StoreProvider>
      <ul>
        <ProductCard product={card} categoryName="Drinkware" index={0} />
      </ul>
    </StoreProvider>,
  );

  await user.click(screen.getByRole("radio", { name: "Crimson" }));
  const nameLink = screen.getByText("Polka Cup").closest("a")!;
  expect(nameLink.getAttribute("data-search")).toBe(JSON.stringify({ variant: 1 }));
});

test("switching colours on ProductPage syncs ?variant= in the URL and Share link", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  navigateMock.mockReset();
  const queryClient = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage product={product} category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }} />
      </StoreProvider>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("radio", { name: "Crimson" }));
  expect(navigateMock).toHaveBeenCalledWith({
    to: "/products/$slug",
    params: { slug: "polka-cup" },
    search: { variant: 1 },
    replace: true,
  });
  const share = screen.getByRole("link", { name: /Share/i });
  expect(share.getAttribute("href")).toContain(encodeURIComponent("?variant=1"));
});

test("switching colours on ProductPage resets the mobile gallery scrollLeft to 0", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const queryClient = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage product={product} category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }} />
      </StoreProvider>
    </QueryClientProvider>,
  );

  const gallery = screen.getByLabelText("Polka Cup photos");
  gallery.scrollLeft = 320;
  await user.click(screen.getByRole("radio", { name: "Crimson" }));
  expect(gallery.scrollLeft).toBe(0);
});

test("ProductPage gallery switches main photo via thumbnails and opens fullscreen lightbox", async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const multiPhoto: PublicProduct = {
    ...product,
    variants: [
      {
        name: "Off-white",
        swatch: "#f5f5f0",
        availability: "in_stock",
        images: ["/media/a1.webp", "/media/a2.webp"],
      },
    ],
  };
  const queryClient = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <ProductPage
          product={multiPhoto}
          category={{ id: "drinkware", name: "Drinkware", description: "", image: "" }}
        />
      </StoreProvider>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("listitem", { name: "Photo 2 of 2" }));
  expect(screen.getByAltText("Polka Cup, Off-white, photo 2 of 2").getAttribute("src")).toBe("/media/a2.webp");

  await user.click(screen.getByRole("button", { name: /View photo 2 of 2 full screen/i }));
  expect(await screen.findByRole("dialog", { name: "Polka Cup photo viewer" })).toBeTruthy();
});

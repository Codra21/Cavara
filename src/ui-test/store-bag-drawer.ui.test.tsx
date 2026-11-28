import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BagLine } from "@/domain/bag";
import { formatPrice } from "@/domain/catalog";
import type { DeliveryZone } from "@/domain/orders";
import type { BagItem } from "@/lib/types";

const storeState = vi.hoisted(() => ({
  bag: [] as BagItem[],
  bagCount: 0,
  bagOpen: true,
  closeBag: vi.fn(),
  updateBagItem: vi.fn(),
  clearBag: vi.fn(),
  showToast: vi.fn(),
}));

const bagLinesState = vi.hoisted(() => ({
  lines: [] as BagLine[],
  zones: [] as DeliveryZone[],
  failed: false,
  retry: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/layout/useShopNavigation", () => ({
  useShopNavigation: () => vi.fn(),
}));
vi.mock("@/components/layout/SiteChrome", () => ({
  Toast: () => null,
}));
vi.mock("@/components/store/StoreProvider", () => ({
  useStore: () => storeState,
}));
vi.mock("@/components/store/useBagLines", () => ({
  useBagLines: () => bagLinesState,
}));
vi.mock("@/server/functions/orders.functions", () => ({
  submitOrderFn: vi.fn(),
}));
vi.mock("@/server/functions/coupons.functions", () => ({
  checkCouponFn: vi.fn(),
}));

const { BagDrawer } = await import("@/components/store/BagDrawer");

afterEach(cleanup);

const zones: DeliveryZone[] = [
  { id: "inside-dhaka", name: "Inside Dhaka", charge: 80, perKgCharge: 20 },
  { id: "outside-dhaka", name: "Outside Dhaka", charge: 130, perKgCharge: 25 },
];

const makeProduct = (
  id: number,
  name: string,
  price: number,
  weightG: number,
  availability: "in_stock" | "out_of_stock",
) => ({
  id,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  category: "drinkware",
  price,
  regularPrice: null,
  sale: null,
  featured: false,
  weightG,
  createdAt: "2026-11-01T00:00:00.000Z",
  images: ["/media/a.webp"],
  variants: [{ name: "Sage", swatch: "#9caf88", availability, image: "/media/a.webp" }],
});

test("BagDrawer displays weight-based delivery charges for carts heavier than 1 kg", () => {
  const heavyProduct = makeProduct(1, "Cast Iron Kettle", 1000, 1500, "in_stock");
  const item: BagItem = { id: 1, variant: 0, qty: 2 }; // 3000 g = 3 kg
  storeState.bag = [item];
  storeState.bagCount = 2;
  storeState.bagOpen = true;
  bagLinesState.lines = [{ status: "ok", item, product: heavyProduct, variant: heavyProduct.variants[0]! }];
  bagLinesState.zones = zones;
  bagLinesState.failed = false;

  render(<BagDrawer />);

  expect(screen.getByText(`2 items · ${formatPrice(2000)}`)).toBeTruthy();
  // 3 kg -> Inside Dhaka: 80 + 20 * (3 - 1) = 120; Outside Dhaka: 130 + 25 * (3 - 1) = 180
  expect(
    screen.getByText(new RegExp(`Delivery Inside Dhaka ${formatPrice(120)} · Outside Dhaka ${formatPrice(180)}\\.`)),
  ).toBeTruthy();
});

test("BagDrawer excludes out_of_stock items from orderable item count and delivery weight", () => {
  const lightBuyable = makeProduct(1, "Espresso Cup", 500, 500, "in_stock");
  const heavySoldOut = makeProduct(2, "Ceramic Pitcher", 900, 3000, "out_of_stock");
  const buyableItem: BagItem = { id: 1, variant: 0, qty: 1 }; // 500 g
  const soldOutItem: BagItem = { id: 2, variant: 0, qty: 2 }; // 6000 g, out of stock

  storeState.bag = [buyableItem, soldOutItem];
  storeState.bagCount = 3;
  storeState.bagOpen = true;
  bagLinesState.lines = [
    { status: "ok", item: buyableItem, product: lightBuyable, variant: lightBuyable.variants[0]! },
    { status: "out_of_stock", item: soldOutItem, product: heavySoldOut, variant: heavySoldOut.variants[0]! },
  ];
  bagLinesState.zones = zones;
  bagLinesState.failed = false;

  render(<BagDrawer />);

  // Only the 1 buyable item is counted alongside the ৳500 orderable subtotal
  expect(screen.getByText(`1 item · ${formatPrice(500)}`)).toBeTruthy();
  // Delivery weight uses only the 500 g buyable item (1 kg base rate), not the 6 kg sold-out item
  expect(
    screen.getByText(new RegExp(`Delivery Inside Dhaka ${formatPrice(80)} · Outside Dhaka ${formatPrice(130)}\\.`)),
  ).toBeTruthy();
});

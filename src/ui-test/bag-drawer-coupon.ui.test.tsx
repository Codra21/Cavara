import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { BagLine } from "@/domain/bag";
import type { DeliveryZone } from "@/domain/orders";
import type { BagItem } from "@/lib/types";

const getTurnstileToken = vi.hoisted(() => vi.fn());
const submitOrderFn = vi.hoisted(() => vi.fn());
const checkCouponFn = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  bag: [] as BagItem[],
  bagOpen: true,
  setBag: (_next: BagItem[]) => {},
  setBagOpen: (_next: boolean) => {},
}));

const product = {
  id: 1,
  slug: "cup",
  name: "Cup",
  category: "drinkware",
  price: 500,
  regularPrice: null,
  sale: null,
  featured: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  images: ["/media/a.webp"],
  variants: [{ name: "Sage", swatch: "#9caf88", availability: "in_stock" as const, image: "/media/a.webp", stock: 5 }],
};
const zones: DeliveryZone[] = [{ id: "inside-dhaka", name: "Inside Dhaka", charge: 80 }];

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/layout/useShopNavigation", () => ({ useShopNavigation: () => vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ getTurnstileToken }));
vi.mock("@/server/functions/orders.functions", () => ({ submitOrderFn }));
vi.mock("@/server/functions/coupons.functions", () => ({ checkCouponFn }));
vi.mock("@/components/store/useBagLines", () => ({
  useBagLines: (bag: BagItem[]) => ({
    lines: bag.map<BagLine>((item) => ({
      status: "ok",
      item,
      product,
      variant: product.variants[0]!,
    })),
    zones,
    failed: false,
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/store/StoreProvider", () => ({
  useStore: () => ({
    bag: storeState.bag,
    bagCount: storeState.bag.reduce((sum, item) => sum + item.qty, 0),
    bagOpen: storeState.bagOpen,
    closeBag: () => storeState.setBagOpen(false),
    updateBagItem: (productId: number, variant: number, qty: number) => {
      storeState.setBag(
        qty <= 0
          ? storeState.bag.filter((item) => !(item.id === productId && item.variant === variant))
          : storeState.bag.map((item) => (item.id === productId && item.variant === variant ? { ...item, qty } : item)),
      );
    },
    clearBag: () => storeState.setBag([]),
    showToast: vi.fn(),
    hideToast: vi.fn(),
    toast: null,
  }),
}));

const { BagDrawer } = await import("@/components/store/BagDrawer");

function TestBagDrawer({ initialBag }: { initialBag: BagItem[] }) {
  const [bag, setBag] = useState<BagItem[]>(initialBag);
  const [bagOpen, setBagOpen] = useState(true);
  storeState.bag = bag;
  storeState.bagOpen = bagOpen;
  storeState.setBag = setBag;
  storeState.setBagOpen = setBagOpen;
  return (
    <>
      <button type="button" onClick={() => setBag([{ id: 1, variant: 0, qty: 1 }])}>
        Refill bag
      </button>
      <button type="button" onClick={() => setBagOpen(true)}>
        Open bag
      </button>
      <BagDrawer />
    </>
  );
}

afterEach(cleanup);

test("applying a coupon, clicking Back to cart, and returning to Checkout preserves the coupon and discount", async () => {
  getTurnstileToken.mockReset().mockResolvedValue("tok-coupon");
  checkCouponFn.mockReset().mockResolvedValue({ ok: true, code: "SAVE200", discount: 200 });
  const user = userEvent.setup();

  render(<TestBagDrawer initialBag={[{ id: 1, variant: 0, qty: 1 }]} />);

  await user.click(screen.getByRole("button", { name: "Checkout" }));
  await user.click(screen.getByText(/Have a code/i));
  await user.type(screen.getByLabelText("Coupon code"), "SAVE200");
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(await screen.findByRole("button", { name: /Remove.*SAVE200/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Place order · ৳\s*380/i })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Back to cart/i }));
  await user.click(screen.getByRole("button", { name: "Checkout" }));

  expect(screen.getByRole("button", { name: /Remove.*SAVE200/i })).toBeTruthy();
  expect(screen.getByText(/−\s*৳\s*200/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Place order · ৳\s*380/i })).toBeTruthy();
});

test("changing cart quantity after clicking Back to cart clears the stale applied coupon on return to Checkout", async () => {
  getTurnstileToken.mockReset().mockResolvedValue("tok-coupon");
  checkCouponFn.mockReset().mockResolvedValue({ ok: true, code: "SAVE200", discount: 200 });
  const user = userEvent.setup();

  render(<TestBagDrawer initialBag={[{ id: 1, variant: 0, qty: 1 }]} />);

  await user.click(screen.getByRole("button", { name: "Checkout" }));
  await user.click(screen.getByText(/Have a code/i));
  await user.type(screen.getByLabelText("Coupon code"), "SAVE200");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("button", { name: /Remove.*SAVE200/i })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Back to cart/i }));
  await user.click(screen.getByRole("button", { name: /Increase quantity/i }));
  await user.click(screen.getByRole("button", { name: "Checkout" }));

  expect(screen.queryByRole("button", { name: /Remove.*SAVE200/i })).toBeNull();
  expect(screen.getByText(/Your cart changed\. Apply your code again\./i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Place order · ৳\s*1,100/i })).toBeTruthy();
});

test("completing an order clears the applied coupon for future checkouts", async () => {
  getTurnstileToken.mockReset().mockResolvedValue("tok-ok");
  checkCouponFn.mockReset().mockResolvedValue({ ok: true, code: "SAVE200", discount: 200 });
  submitOrderFn.mockReset().mockResolvedValue({ ok: true, reference: "CV-222222", total: 380, replayed: false });
  const user = userEvent.setup();

  render(<TestBagDrawer initialBag={[{ id: 1, variant: 0, qty: 1 }]} />);

  await user.click(screen.getByRole("button", { name: "Checkout" }));
  await user.click(screen.getByText(/Have a code/i));
  await user.type(screen.getByLabelText("Coupon code"), "SAVE200");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("button", { name: /Remove.*SAVE200/i })).toBeTruthy();

  await user.type(screen.getByLabelText("Full name"), "Ayesha");
  await user.type(screen.getByLabelText("Mobile number"), "01711000001");
  await user.type(screen.getByLabelText("Full address"), "Dhaka");
  await user.click(screen.getByRole("button", { name: /Place order · ৳\s*380/i }));
  expect(await screen.findByText(/Order received/i)).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Continue shopping/i }));
  await user.click(screen.getByRole("button", { name: "Refill bag" }));
  await user.click(screen.getByRole("button", { name: "Open bag" }));
  await user.click(screen.getByRole("button", { name: "Checkout" }));

  expect(screen.queryByRole("button", { name: /Remove.*SAVE200/i })).toBeNull();
  expect(screen.getByRole("button", { name: /Place order · ৳\s*580/i })).toBeTruthy();
});

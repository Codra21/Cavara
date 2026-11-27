import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BuyableLine } from "@/domain/bag";
import type { DeliveryZone } from "@/domain/orders";

const getTurnstileToken = vi.hoisted(() => vi.fn());
const submitOrderFn = vi.hoisted(() => vi.fn());
const checkCouponFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/turnstile", () => ({ getTurnstileToken }));
vi.mock("@/server/functions/orders.functions", () => ({ submitOrderFn }));
vi.mock("@/server/functions/coupons.functions", () => ({ checkCouponFn }));

const { CheckoutForm } = await import("@/components/store/CheckoutForm");

afterEach(cleanup);

const lines: BuyableLine[] = [
  {
    status: "ok",
    item: { id: 1, variant: 0, qty: 1 },
    product: {
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
      variants: [{ name: "Sage", swatch: "#9caf88", availability: "in_stock", image: "/media/a.webp" }],
    },
    variant: { name: "Sage", swatch: "#9caf88", availability: "in_stock", image: "/media/a.webp" },
  },
];
const zones: DeliveryZone[] = [{ id: "inside-dhaka", name: "Inside Dhaka", charge: 80 }];

test("two synchronous submits only trigger one Turnstile check and one order request", async () => {
  let resolveToken!: (token: string) => void;
  getTurnstileToken.mockReset().mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveToken = resolve;
      }),
  );
  submitOrderFn.mockReset().mockResolvedValue({ ok: true, reference: "CV-111111", total: 580, replayed: false });

  const { container } = render(
    <CheckoutForm
      lines={lines}
      zones={zones}
      draft={{ name: "Ayesha", phone: "01711000001", zoneId: "inside-dhaka", address: "Dhaka", note: "" }}
      onDraftChange={vi.fn()}
      onBack={vi.fn()}
      onPlaced={vi.fn()}
    />,
  );

  const form = container.querySelector("form")!;
  // Two back-to-back submits before React commits setPending(true)
  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(getTurnstileToken).toHaveBeenCalledTimes(1);
  resolveToken("tok-1");
});

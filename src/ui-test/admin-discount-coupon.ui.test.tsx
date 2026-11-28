import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminCoupon } from "@/domain/coupons";
import type { AdminDiscount } from "@/domain/discounts";

const saveDiscountFn = vi.hoisted(() => vi.fn());
const saveCouponFn = vi.hoisted(() => vi.fn());

vi.mock("@/server/functions/admin-discounts.functions", () => ({ saveDiscountFn, saveCouponFn }));
vi.mock("@/components/admin/queries", () => ({
  ADMIN_QUERY_KEY: ["admin"],
  adminCategoriesQuery: () => ({ queryKey: ["admin", "categories"], queryFn: async () => [] }),
  adminProductNamesQuery: () => ({ queryKey: ["admin", "product-names"], queryFn: async () => [] }),
}));

const { DiscountEditor } = await import("@/components/admin/DiscountEditor");
const { CouponEditor } = await import("@/components/admin/CouponEditor");

afterEach(cleanup);

const sampleDiscount: AdminDiscount = {
  id: 1,
  name: "Winter Sale",
  type: "percent",
  value: 15,
  scope: "all",
  categoryId: null,
  productId: null,
  targetName: null,
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: null,
  active: true,
  revision: "rev-1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const sampleCoupon: AdminCoupon = {
  id: 10,
  name: "Winter Coupon",
  code: "WINTER15",
  type: "percent",
  value: 15,
  minOrder: null,
  maxDiscount: null,
  usageLimit: null,
  usedCount: 0,
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: null,
  active: true,
  revision: "rev-1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

test("toggling a sale row in the table does not discard an open Add sale draft", async () => {
  saveDiscountFn
    .mockReset()
    .mockResolvedValue({ ok: true, discount: { ...sampleDiscount, active: false, revision: "rev-2" } });
  const client = new QueryClient();
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <QueryClientProvider client={client}>
      <DiscountEditor discounts={[sampleDiscount]} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: /Add sale/i }));
  const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
  await user.type(nameInput, "Eid Special");

  await user.click(screen.getByRole("button", { name: /Switch off/i }));
  await waitFor(() => expect(saveDiscountFn).toHaveBeenCalledTimes(1));

  // Draft must still be open with the user's unsaved text.
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Eid Special");
});

test("toggling an open edited sale syncs form revision and active state for the next save", async () => {
  saveDiscountFn
    .mockReset()
    .mockResolvedValueOnce({ ok: true, discount: { ...sampleDiscount, active: false, revision: "rev-2" } })
    .mockResolvedValueOnce({
      ok: true,
      discount: { ...sampleDiscount, name: "Winter Mega Sale", active: false, revision: "rev-3" },
    });
  const client = new QueryClient();
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <QueryClientProvider client={client}>
      <DiscountEditor discounts={[sampleDiscount]} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: /Edit.*Winter Sale/i }));
  const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
  await user.clear(nameInput);
  await user.type(nameInput, "Winter Mega Sale");

  await user.click(screen.getByRole("button", { name: /Switch off.*Winter Sale/i }));
  await waitFor(() => expect(saveDiscountFn).toHaveBeenCalledTimes(1));

  // Unsaved edits remain intact while active state reflects the toggle.
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Winter Mega Sale");

  await user.click(screen.getByRole("button", { name: /Save sale/i }));
  await waitFor(() => expect(saveDiscountFn).toHaveBeenCalledTimes(2));

  expect(saveDiscountFn).toHaveBeenNthCalledWith(2, {
    data: expect.objectContaining({
      id: 1,
      revision: "rev-2",
      input: expect.objectContaining({
        name: "Winter Mega Sale",
        active: false,
      }),
    }),
  });
});

test("toggling an open edited coupon syncs form revision and active state for the next save", async () => {
  saveCouponFn
    .mockReset()
    .mockResolvedValueOnce({ ok: true, coupon: { ...sampleCoupon, active: false, revision: "rev-2" } })
    .mockResolvedValueOnce({
      ok: true,
      coupon: { ...sampleCoupon, name: "Winter Mega Coupon", active: false, revision: "rev-3" },
    });
  const client = new QueryClient();
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <QueryClientProvider client={client}>
      <CouponEditor coupons={[sampleCoupon]} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: /Edit.*WINTER15/i }));
  const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
  await user.clear(nameInput);
  await user.type(nameInput, "Winter Mega Coupon");

  await user.click(screen.getByRole("button", { name: /Switch off.*WINTER15/i }));
  await waitFor(() => expect(saveCouponFn).toHaveBeenCalledTimes(1));

  // Unsaved edits remain intact while active state reflects the toggle.
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Winter Mega Coupon");

  await user.click(screen.getByRole("button", { name: /Save coupon/i }));
  await waitFor(() => expect(saveCouponFn).toHaveBeenCalledTimes(2));

  expect(saveCouponFn).toHaveBeenNthCalledWith(2, {
    data: expect.objectContaining({
      id: 10,
      revision: "rev-2",
      input: expect.objectContaining({
        name: "Winter Mega Coupon",
        active: false,
      }),
    }),
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminOrderDetail } from "@/domain/orders";

const updateOrderFn = vi.hoisted(() => vi.fn());
const invalidateProductData = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/server/functions/admin-orders.functions", () => ({ updateOrderFn }));
vi.mock("@/components/admin/queries", () => ({
  ADMIN_QUERY_KEY: ["admin"],
  invalidateProductData,
}));
vi.mock("@/components/admin/BlockPhoneCard", () => ({ BlockPhoneCard: () => null }));

const { OrderDetail } = await import("@/components/admin/OrderDetail");

afterEach(cleanup);

const baseOrder: AdminOrderDetail = {
  id: "ord-1",
  reference: "CV-123456",
  status: "new",
  paymentStatus: "unpaid",
  customerName: "Ayesha",
  phone: "01711000001",
  address: "Dhaka",
  note: "",
  zoneId: "inside-dhaka",
  zoneName: "Inside Dhaka",
  itemsTotal: 1000,
  couponCode: "SAVE10",
  couponDiscount: 100,
  subtotal: 900,
  deliveryCharge: 80,
  total: 980,
  itemCount: 1,
  shopDay: "2026-11-15",
  version: 1,
  createdAt: "2026-11-15T10:00:00.000Z",
  lines: [
    {
      line: 0,
      productId: 1,
      variantPosition: 0,
      discountId: null,
      productName: "Cup",
      variantName: "Sage",
      availability: "in_stock",
      unitPrice: 1000,
      listPrice: 1000,
      costPrice: 500,
      qty: 1,
      lineTotal: 1000,
    },
  ],
  history: [],
};

test("cancelling an order invalidates coupons, stock movements and product queries", async () => {
  updateOrderFn.mockReset().mockResolvedValue({ ok: true, version: 2 });
  invalidateProductData.mockClear();

  const client = new QueryClient();
  const invSpy = vi.spyOn(client, "invalidateQueries");
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  render(
    <QueryClientProvider client={client}>
      <OrderDetail order={baseOrder} isOwner />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("combobox", { name: /Status/i }));
  await user.click(await screen.findByRole("option", { name: /Cancel/i }));
  await user.click(screen.getByRole("button", { name: /^Save$/i }));
  await user.click(await screen.findByRole("button", { name: /Cancel order/i }));

  await waitFor(() => expect(updateOrderFn).toHaveBeenCalledTimes(1));
  const keys = invSpy.mock.calls.map(([arg]) => (arg as { queryKey?: unknown[] })?.queryKey);
  expect(keys).toContainEqual(["admin", "coupons"]);
  expect(keys).toContainEqual(["admin", "stock-movements"]);
  expect(invalidateProductData).toHaveBeenCalledWith(client);
});

test("a cache-refresh warning from updateOrderFn is surfaced via onWarning and rendered", async () => {
  updateOrderFn.mockReset().mockResolvedValue({
    ok: true,
    version: 2,
    warning: "Saved, but the shop's copy of the stock could not be updated.",
  });
  const onWarning = vi.fn();
  const client = new QueryClient();
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  render(
    <QueryClientProvider client={client}>
      <OrderDetail
        order={baseOrder}
        isOwner
        warning="Saved, but the shop's copy of the stock could not be updated."
        onWarning={onWarning}
      />
    </QueryClientProvider>,
  );

  expect(screen.getByRole("status").textContent).toContain("shop's copy of the stock");

  await user.click(screen.getByRole("combobox", { name: /Status/i }));
  await user.click(await screen.findByRole("option", { name: /Cancel/i }));
  await user.click(screen.getByRole("button", { name: /^Save$/i }));
  await user.click(await screen.findByRole("button", { name: /Cancel order/i }));

  await waitFor(() =>
    expect(onWarning).toHaveBeenCalledWith("Saved, but the shop's copy of the stock could not be updated."),
  );
});

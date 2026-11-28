import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { formatPrice } from "@/domain/catalog";
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

test("receipt footer shows Order total, Paid, and Balance to collect for partially paid and fully paid orders", () => {
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <OrderDetail
        order={{ ...baseOrder, status: "confirmed", paymentStatus: "partially_paid", amountPaid: 400 }}
        isOwner={false}
      />
    </QueryClientProvider>,
  );

  const tfoot = document.querySelector("tfoot");
  expect(tfoot).not.toBeNull();
  expect(tfoot!.textContent).not.toContain("Total to collect");
  expect(tfoot!.textContent).toContain("Order total");
  expect(tfoot!.textContent).toContain(formatPrice(980));
  expect(tfoot!.textContent).toContain("Paid");
  expect(tfoot!.textContent).toContain(formatPrice(400));
  expect(tfoot!.textContent).toContain("Balance to collect");
  expect(tfoot!.textContent).toContain(formatPrice(580));

  rerender(
    <QueryClientProvider client={client}>
      <OrderDetail
        order={{ ...baseOrder, status: "confirmed", paymentStatus: "paid", amountPaid: 980 }}
        isOwner={false}
      />
    </QueryClientProvider>,
  );

  expect(tfoot!.textContent).not.toContain("Total to collect");
  expect(tfoot!.textContent).toContain("Order total");
  expect(tfoot!.textContent).toContain("Paid");
  expect(tfoot!.textContent).toContain("Balance to collect");
  expect(tfoot!.textContent).toContain(formatPrice(0));
});

test("cancelled order shows ৳0 balance due in header and footer", () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <OrderDetail
        order={{ ...baseOrder, status: "cancelled", paymentStatus: "unpaid", amountPaid: 0 }}
        isOwner={false}
      />
    </QueryClientProvider>,
  );

  expect(screen.getByText(/Balance due/i).textContent).toContain(`Balance due ${formatPrice(0)}`);
  const tfoot = document.querySelector("tfoot");
  expect(tfoot).not.toBeNull();
  expect(tfoot!.textContent).toContain("Balance to collect");
  expect(tfoot!.textContent).toContain(formatPrice(0));
});

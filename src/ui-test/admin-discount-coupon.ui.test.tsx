import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
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

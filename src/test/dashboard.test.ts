import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  addDays,
  addMonths,
  buildDashboard,
  DASHBOARD_DAYS,
  DASHBOARD_MONTHS,
  dashboardRange,
} from "@/domain/dashboard";
import { updateOrderStatus } from "@/server/db/admin-orders.repository";
import { getDashboard } from "@/server/db/dashboard.repository";
import { submitOrder } from "@/server/services/orders.service";
import { createTestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };

describe("calendar helpers", () => {
  test("days and months roll over correctly", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
  });
  test("the range covers 12 months from the 1st, through today in Dhaka", () => {
    // 20:30 UTC on 31 Dec is already 1 Jan in Dhaka.
    expect(dashboardRange(new Date("2026-12-31T20:30:00Z"))).toEqual({ from: "2026-02-01", to: "2027-01-01" });
  });
});

describe("buildDashboard", () => {
  test("zero-fills days and months and sums months", () => {
    const now = new Date("2026-11-07T06:00:00Z");
    const row = (key: string, revenue: number) => ({
      key,
      ordersReceived: 1,
      ordersSold: 1,
      revenue,
      profit: revenue / 2,
      linesWithoutCost: 0,
    });
    const dash = buildDashboard([row("2026-11-07", 100), row("2026-11-01", 50), row("2026-10-31", 30)], now, {
      pending: 0,
      failed: 0,
      configured: true,
    });
    expect(dash.days).toHaveLength(DASHBOARD_DAYS);
    expect(dash.days.at(-1)).toMatchObject({ key: "2026-11-07", revenue: 100 });
    expect(dash.months).toHaveLength(DASHBOARD_MONTHS);
    expect(dash.thisMonth).toMatchObject({ key: "2026-11", revenue: 150, profit: 75, ordersSold: 2 });
    expect(dash.lastMonth).toMatchObject({ key: "2026-10", revenue: 30 });
    expect(dash.yesterday).toMatchObject({ key: "2026-11-06", revenue: 0 });
  });
});

test("getDashboard reflects a placed and a confirmed order, and waiting alerts", async () => {
  const db = createTestD1();
  db.sqlite.run("UPDATE products SET cost_price = 100");
  const [product] = db.sqlite
    .query(
      "SELECT p.id, p.price, v.position FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.status = 'published' ORDER BY p.id LIMIT 1",
    )
    .all() as { id: number; price: number; position: number }[];
  const now = new Date("2026-11-07T06:00:00Z");
  const result = await submitOrder(
    db,
    {
      idempotencyKey: crypto.randomUUID(),
      name: "Test",
      phone: "01712345678",
      zoneId: "inside-dhaka",
      address: "House 1, Road 2, Dhaka",
      note: "",
      deliveryCharge: 80,
      items: [{ productId: product!.id, variant: product!.position, qty: 2, unitPrice: product!.price }],
      website: "",
    },
    { client: "c", limitSecret: "x".repeat(40), now },
  );
  if (!result.ok) throw new Error(result.message);
  await updateOrderStatus(
    db,
    owner,
    { id: result.orderId, version: 1, status: "confirmed", paymentStatus: "unpaid", note: "" },
    now,
  );

  const dash = await getDashboard(db, now, false);
  expect(dash.today).toMatchObject({
    key: "2026-11-07",
    ordersReceived: 1,
    ordersSold: 1,
    revenue: product!.price * 2,
    profit: (product!.price - 100) * 2,
  });
  expect(dash.alerts).toEqual({ pending: 1, failed: 0, configured: false });
  const plan = (
    db.sqlite.query("EXPLAIN QUERY PLAN SELECT * FROM daily_totals WHERE shop_day BETWEEN 'a' AND 'b'").all() as {
      detail: string;
    }[]
  )[0]!.detail;
  expect(plan).toMatch(
    /SEARCH daily_totals USING (INDEX|PRIMARY KEY|INTEGER PRIMARY KEY)|USING INDEX sqlite_autoindex_daily_totals/,
  );
});

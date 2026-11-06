// Owner dashboard reads. Server-only. daily_totals is read by primary-key range (≤ ~370 rows) and the alert counts
// come from the outbox's partial indexes, so a dashboard view stays cheap on the D1 read budget.
import { buildDashboard, type Dashboard, dashboardRange, type DayTotals } from "@/domain/dashboard";
import type { D1Database } from "./d1";

interface TotalsRow {
  shop_day: string;
  orders_received: number;
  orders_sold: number;
  revenue: number;
  profit: number;
  lines_without_cost: number;
}

export async function getDashboard(db: D1Database, now: Date, alertsConfigured: boolean): Promise<Dashboard> {
  const { from, to } = dashboardRange(now);
  const [totals, pending, failed] = await db.batch([
    db
      .prepare(
        `SELECT shop_day, orders_received, orders_sold, revenue, profit, lines_without_cost
         FROM daily_totals WHERE shop_day BETWEEN ? AND ?`,
      )
      .bind(from, to),
    db.prepare(
      `SELECT count(*) AS n FROM (
         SELECT 1 FROM order_notification_outbox WHERE status = 'pending'
         UNION ALL SELECT 1 FROM order_notification_outbox WHERE status = 'sending')`,
    ),
    db.prepare("SELECT count(*) AS n FROM order_notification_outbox WHERE status = 'failed'"),
  ]);
  const rows: DayTotals[] = ((totals?.results ?? []) as TotalsRow[]).map((row) => ({
    key: row.shop_day,
    ordersReceived: row.orders_received,
    ordersSold: row.orders_sold,
    revenue: row.revenue,
    profit: row.profit,
    linesWithoutCost: row.lines_without_cost,
  }));
  const count = (result: typeof pending) => Number((result?.results[0] as { n: number } | undefined)?.n ?? 0);
  return buildDashboard(rows, now, { pending: count(pending), failed: count(failed), configured: alertsConfigured });
}

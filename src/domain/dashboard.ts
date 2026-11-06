// Owner dashboard: orders received, sales, revenue and profit per Bangladesh day and month. Pure.
// Built from daily_totals rows (one per day, kept up to date in the order and status-change batches), so a dashboard
// view reads at most ~400 small rows and never sums orders (code-standards: D1 read budget).
import { shopDay } from "./orders";

export interface DayTotals {
  /** YYYY-MM-DD (Asia/Dhaka) or YYYY-MM for months. */
  key: string;
  ordersReceived: number;
  ordersSold: number;
  /** Item subtotal of sold orders, whole BDT (delivery charges excluded). */
  revenue: number;
  /** Σ (unit price − cost price) × qty over sold lines that have a cost price. */
  profit: number;
  /** Sold lines without a cost price: profit is incomplete when > 0. */
  linesWithoutCost: number;
}

export interface Dashboard {
  today: DayTotals;
  yesterday: DayTotals;
  thisMonth: DayTotals;
  lastMonth: DayTotals;
  /** The last 30 days, oldest first, zero-filled. */
  days: DayTotals[];
  /** The last 12 months including this one, oldest first, zero-filled. */
  months: DayTotals[];
  alerts: { pending: number; failed: number; configured: boolean };
}

export const DASHBOARD_DAYS = 30;
export const DASHBOARD_MONTHS = 12;

export const emptyTotals = (key: string): DayTotals => ({
  key,
  ordersReceived: 0,
  ordersSold: 0,
  revenue: 0,
  profit: 0,
  linesWithoutCost: 0,
});

function add(into: DayTotals, row: DayTotals): DayTotals {
  return {
    key: into.key,
    ordersReceived: into.ordersReceived + row.ordersReceived,
    ordersSold: into.ordersSold + row.ordersSold,
    revenue: into.revenue + row.revenue,
    profit: into.profit + row.profit,
    linesWithoutCost: into.linesWithoutCost + row.linesWithoutCost,
  };
}

/** Shifts a YYYY-MM-DD day by whole days (calendar arithmetic in UTC, so no time-zone drift). */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Shifts a YYYY-MM month by whole months. */
export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** The day range the dashboard needs: the first day of the oldest month shown, through today. */
export function dashboardRange(now: Date): { from: string; to: string } {
  const today = shopDay(now);
  const firstMonth = addMonths(today.slice(0, 7), -(DASHBOARD_MONTHS - 1));
  const thirtyDaysBack = addDays(today, -(DASHBOARD_DAYS - 1));
  const from = `${firstMonth}-01` < thirtyDaysBack ? `${firstMonth}-01` : thirtyDaysBack;
  return { from, to: today };
}

export function buildDashboard(rows: DayTotals[], now: Date, alerts: Dashboard["alerts"]): Dashboard {
  const today = shopDay(now);
  const byDay = new Map(rows.map((row) => [row.key, row]));
  const day = (key: string) => byDay.get(key) ?? emptyTotals(key);

  const days = Array.from({ length: DASHBOARD_DAYS }, (_, i) => day(addDays(today, i - (DASHBOARD_DAYS - 1))));

  const thisMonthKey = today.slice(0, 7);
  const monthKeys = Array.from({ length: DASHBOARD_MONTHS }, (_, i) =>
    addMonths(thisMonthKey, i - (DASHBOARD_MONTHS - 1)),
  );
  const monthTotals = new Map(monthKeys.map((key) => [key, emptyTotals(key)]));
  for (const row of rows) {
    const key = row.key.slice(0, 7);
    const total = monthTotals.get(key);
    if (total) monthTotals.set(key, add(total, row));
  }
  const months = monthKeys.map((key) => monthTotals.get(key)!);

  return {
    today: day(today),
    yesterday: day(addDays(today, -1)),
    thisMonth: monthTotals.get(thisMonthKey)!,
    lastMonth: monthTotals.get(addMonths(thisMonthKey, -1))!,
    days,
    months,
    alerts,
  };
}

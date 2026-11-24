import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BellOff, Calendar, CalendarDays, CalendarRange, Clock, TrendingUp } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatPrice } from "@/domain/catalog";
import type { DayTotals } from "@/domain/dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminDashboardQuery } from "./queries";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

const labelDay = (key: string) => dayLabel.format(new Date(`${key}T00:00:00Z`));
const labelMonth = (key: string) => monthLabel.format(new Date(`${key}-01T00:00:00Z`));

function Stat({
  title,
  totals,
  note,
  icon,
  accent,
}: {
  title: string;
  totals: DayTotals;
  note?: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={`gap-2.5 py-4 ${accent ? "ring-primary/30" : ""}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
        <div className="grid gap-1">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">{title}</CardDescription>
          <CardTitle className="text-2xl font-bold tracking-tight tabular-nums">
            {formatPrice(totals.revenue)}
          </CardTitle>
        </div>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
            accent ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
          } [&_svg]:size-4`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </CardHeader>
      <CardContent className="grid gap-1 px-4 text-xs text-muted-foreground">
        <span className="tabular-nums">
          <span className="font-medium text-foreground">{totals.ordersReceived}</span> received ·{" "}
          <span className="font-medium text-foreground">{totals.ordersSold}</span> sold
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <span>Profit</span>
          <span className={`font-semibold ${totals.profit > 0 ? "text-success" : "text-foreground"}`}>
            {formatPrice(totals.profit)}
          </span>
          {totals.linesWithoutCost ? <span title="Some sold lines have no cost price">*</span> : null}
        </span>
        {note ? <span className="text-[11px]">{note}</span> : null}
      </CardContent>
    </Card>
  );
}

function TotalsTable({ rows, label, caption }: { rows: DayTotals[]; label: (key: string) => string; caption: string }) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">{caption.startsWith("Daily") ? "Day" : "Month"}</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Sold</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="pr-4 text-right">Profit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...rows].reverse().map((row) => {
          const empty = row.ordersReceived === 0 && row.ordersSold === 0;
          return (
            <TableRow key={row.key} className={empty ? "text-muted-foreground" : undefined}>
              <TableCell className="pl-4 font-medium">{label(row.key)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.ordersReceived}</TableCell>
              <TableCell className="text-right tabular-nums">{row.ordersSold}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatPrice(row.revenue)}</TableCell>
              <TableCell
                className={`pr-4 text-right tabular-nums ${!empty && row.profit > 0 ? "font-medium text-success" : ""}`}
              >
                {formatPrice(row.profit)}
                {row.linesWithoutCost ? "*" : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Owner-only sales overview from daily_totals. Times are Bangladesh time. */
export function DashboardPanel() {
  const dashboard = useQuery(adminDashboardQuery());
  const [view, setView] = useState<"days" | "months">("days");

  if (dashboard.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle />
        <AlertDescription>{dashboard.error.message || "Could not load the dashboard."}</AlertDescription>
      </Alert>
    );
  }
  if (!dashboard.data) return <p className="text-sm text-muted-foreground">Loading sales…</p>;
  const data = dashboard.data;
  const incomplete = [data.today, data.yesterday, data.thisMonth, data.lastMonth, ...data.days, ...data.months].some(
    (row) => row.linesWithoutCost > 0,
  );

  return (
    <section aria-labelledby="sales-title" className="grid gap-4">
      <h2 id="sales-title" className="sr-only">
        Sales
      </h2>

      {!data.alerts.configured ? (
        <Alert variant="info">
          <BellOff />
          <AlertTitle>Order alerts are off</AlertTitle>
          <AlertDescription>
            Telegram alerts start once TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set for the Worker. New orders still
            arrive in the inbox.
          </AlertDescription>
        </Alert>
      ) : data.alerts.failed > 0 || data.alerts.pending > 0 ? (
        <Alert variant={data.alerts.failed ? "destructive" : "warning"}>
          {data.alerts.failed ? <AlertTriangle /> : <Clock />}
          <AlertTitle>
            {data.alerts.failed
              ? `${data.alerts.failed} order alert${data.alerts.failed === 1 ? "" : "s"} could not be sent`
              : `${data.alerts.pending} order alert${data.alerts.pending === 1 ? "" : "s"} waiting to send`}
          </AlertTitle>
          <AlertDescription>
            Check the orders inbox. Waiting alerts are retried every 5 minutes; failed ones stopped after 12 tries.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Today" totals={data.today} icon={<TrendingUp />} accent />
        <Stat title="Yesterday" totals={data.yesterday} icon={<Clock />} />
        <Stat
          title={labelMonth(data.thisMonth.key)}
          totals={data.thisMonth}
          note="This month so far"
          icon={<CalendarDays />}
        />
        <Stat
          title={labelMonth(data.lastMonth.key)}
          totals={data.lastMonth}
          note="Last month"
          icon={<CalendarRange />}
        />
      </div>

      <Card className="py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
          <div>
            <CardTitle>{view === "days" ? "Last 30 days" : "Last 12 months"}</CardTitle>
            <CardDescription className="mt-0.5">
              Revenue is the item total of confirmed, dispatched and delivered orders, on the day they were placed.
              Delivery charges are not included.
            </CardDescription>
          </div>
          <SegmentedControl
            aria-label="Period"
            value={view}
            onValueChange={(next) => next && setView(next)}
            className="flex-nowrap bg-muted p-0.5 ring-0"
          >
            <SegmentedControlItem value="days">
              <Calendar /> Days
            </SegmentedControlItem>
            <SegmentedControlItem value="months">
              <CalendarRange /> Months
            </SegmentedControlItem>
          </SegmentedControl>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {view === "days" ? (
            <TotalsTable rows={data.days} label={labelDay} caption="Daily sales, newest first" />
          ) : (
            <TotalsTable rows={data.months} label={labelMonth} caption="Monthly sales, newest first" />
          )}
          {incomplete ? (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              * Some sold pieces have no cost price, so this profit is lower than the real figure. Add cost prices in
              Products.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

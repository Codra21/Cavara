import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatPrice } from "@/domain/catalog";
import type { DayTotals } from "@/domain/dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function Stat({ title, totals, note }: { title: string; totals: DayTotals; note?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{formatPrice(totals.revenue)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-0.5 px-4 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {totals.ordersReceived} received · {totals.ordersSold} sold
        </span>
        <span className="tabular-nums">
          Profit {formatPrice(totals.profit)}
          {totals.linesWithoutCost ? <span title="Some sold lines have no cost price">*</span> : null}
        </span>
        {note ? <span className="text-xs">{note}</span> : null}
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
              <TableCell className="pl-4">{label(row.key)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.ordersReceived}</TableCell>
              <TableCell className="text-right tabular-nums">{row.ordersSold}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPrice(row.revenue)}</TableCell>
              <TableCell className="pr-4 text-right tabular-nums">
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
        <Alert>
          <AlertTitle>Order alerts are off</AlertTitle>
          <AlertDescription>
            Telegram alerts start once TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set for the Worker. New orders still
            arrive in the inbox.
          </AlertDescription>
        </Alert>
      ) : data.alerts.failed > 0 || data.alerts.pending > 0 ? (
        <Alert variant={data.alerts.failed ? "destructive" : "default"}>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat title="Today" totals={data.today} />
        <Stat title="Yesterday" totals={data.yesterday} />
        <Stat title={labelMonth(data.thisMonth.key)} totals={data.thisMonth} note="This month so far" />
        <Stat title={labelMonth(data.lastMonth.key)} totals={data.lastMonth} note="Last month" />
      </div>

      <Card className="py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <div>
            <CardTitle>{view === "days" ? "Last 30 days" : "Last 12 months"}</CardTitle>
            <CardDescription>
              Revenue is the item total of confirmed, dispatched and delivered orders, on the day they were placed.
              Delivery charges are not included.
            </CardDescription>
          </div>
          <div role="group" aria-label="Period" className="flex gap-1">
            <Button
              size="sm"
              variant={view === "days" ? "secondary" : "ghost"}
              aria-pressed={view === "days"}
              onClick={() => setView("days")}
            >
              Days
            </Button>
            <Button
              size="sm"
              variant={view === "months" ? "secondary" : "ghost"}
              aria-pressed={view === "months"}
              onClick={() => setView("months")}
            >
              Months
            </Button>
          </div>
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

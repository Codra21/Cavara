import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Inbox,
  PackageCheck,
  RotateCcw,
  Search,
  Sparkles,
  Truck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { formatPrice } from "@/domain/catalog";
import {
  formatPhone,
  parseOrderSearch,
  type OrderStatus,
  PAYMENT_LABELS,
  type PaymentStatus,
  STATUS_LABELS,
} from "@/domain/orders";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminTimeFormat } from "./ActivityLog";
import { adminOrdersQuery, type OrderStatusFilter } from "./queries";

const ORDER_BADGE_META: Record<
  OrderStatus,
  { variant: "info" | "warning" | "dispatch" | "success" | "destructive"; icon: typeof Sparkles }
> = {
  new: { variant: "info", icon: Sparkles },
  confirmed: { variant: "warning", icon: CheckCircle2 },
  dispatched: { variant: "dispatch", icon: Truck },
  delivered: { variant: "success", icon: PackageCheck },
  cancelled: { variant: "destructive", icon: XCircle },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { variant, icon: Icon } = ORDER_BADGE_META[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const PAYMENT_BADGE_META: Record<
  PaymentStatus,
  { variant: "success" | "outline" | "warning"; icon: typeof CheckCircle2 }
> = {
  paid: { variant: "success", icon: CheckCircle2 },
  unpaid: { variant: "outline", icon: Clock },
  refunded: { variant: "warning", icon: RotateCcw },
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { variant, icon: Icon } = PAYMENT_BADGE_META[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {PAYMENT_LABELS[status]}
    </Badge>
  );
}

const FILTERS: OrderStatusFilter[] = ["new", "confirmed", "dispatched", "delivered", "cancelled", "all"];

export function OrderList() {
  const [status, setStatus] = useState<OrderStatusFilter>("new");
  const [searchInput, setSearchInput] = useState("");
  // Each keystroke would be a D1 query; wait until typing pauses (same 500 ms as the shop search).
  const typed = useDebouncedValue(searchInput.trim(), 500);
  // Only complete phone numbers and references are searchable (exact, indexed lookups); anything else waits.
  const search = typed && parseOrderSearch(typed) ? typed : "";
  const incomplete = Boolean(typed) && !search;
  const orders = useInfiniteQuery(adminOrdersQuery(search ? "all" : status, search));
  const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Call each new order to confirm it, then move it along as it ships. Times are Bangladesh time.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Phone number or order reference"
            aria-label="Search orders by phone number or reference"
            className="bg-card pl-8.5"
          />
        </div>
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap gap-1 rounded-lg bg-card p-1 ring-1 ring-border"
        >
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={!search && status === value ? "default" : "ghost"}
              aria-pressed={!search && status === value}
              disabled={Boolean(search)}
              onClick={() => setStatus(value)}
            >
              {value === "all" ? "All" : STATUS_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>
      {search || incomplete ? (
        <p className="-mt-3 text-xs text-muted-foreground" aria-live="polite">
          {search
            ? "Searching every status."
            : "Enter a full mobile number (01XXXXXXXXX) or a reference like CV-7KQ2MX."}
        </p>
      ) : null}

      {orders.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{orders.error.message || "Could not load orders."}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          {orders.isPending ? <p className="p-6 text-center text-sm text-muted-foreground">Loading orders…</p> : null}
          {orders.isSuccess && rows.length === 0 ? (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {search ? "No matching orders" : "No orders in this status"}
              </p>
              <p className="text-xs text-muted-foreground">
                {search
                  ? "Check the phone number or order reference and try again."
                  : "Orders will appear here as soon as they move into this stage."}
              </p>
            </div>
          ) : null}
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Area</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden pr-4 sm:table-cell">Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="pl-4">
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="font-semibold text-primary tabular-nums hover:underline"
                      >
                        {order.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <time dateTime={order.createdAt}>{adminTimeFormat.format(new Date(order.createdAt))}</time>
                      </div>
                      {/* Phones: the status column is hidden, so the badges sit under the reference. */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                        <OrderStatusBadge status={order.status} />
                        <PaymentBadge status={order.paymentStatus} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[12rem] whitespace-normal">
                      <div className="font-medium text-foreground">{order.customerName}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatPhone(order.phone)}</div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{order.zoneName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="font-semibold text-foreground">{formatPrice(order.total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="hidden pr-4 sm:table-cell">
                      <PaymentBadge status={order.paymentStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {orders.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => orders.fetchNextPage()} disabled={orders.isFetchingNextPage}>
            {orders.isFetchingNextPage ? "Loading…" : "Load older orders"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const variant = status === "new" ? "default" : status === "cancelled" ? "outline" : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={status === "paid" ? "text-foreground" : "text-muted-foreground"}>{PAYMENT_LABELS[status]}</span>
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Phone number or order reference"
          aria-label="Search orders by phone number or reference"
          className="w-full sm:w-72"
        />
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={!search && status === value ? "secondary" : "ghost"}
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
          <AlertDescription>{orders.error.message || "Could not load orders."}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          {orders.isPending ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
          {orders.isSuccess && rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {search ? "No order matches that phone number or reference." : "No orders here."}
            </p>
          ) : null}
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
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
                        className="font-medium text-foreground tabular-nums hover:underline"
                      >
                        {order.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <time dateTime={order.createdAt}>{adminTimeFormat.format(new Date(order.createdAt))}</time>
                      </div>
                      {/* Phones: the status column is hidden, so the badge sits under the reference. */}
                      <div className="mt-1 sm:hidden">
                        <OrderStatusBadge status={order.status} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[12rem] whitespace-normal">
                      <div className="font-medium text-foreground">{order.customerName}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatPhone(order.phone)}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{order.zoneName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPrice(order.total)}
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  History,
  MapPin,
  MessageCircle,
  Phone,
  Receipt,
  Save,
  StickyNote,
  User,
  XCircle,
} from "lucide-react";
import { useId, useState } from "react";
import { formatPrice } from "@/domain/catalog";
import {
  type AdminOrderDetail,
  formatPhone,
  type OrderStatus,
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  type PaymentStatus,
  STATUS_ACTIONS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
} from "@/domain/orders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { updateOrderFn } from "@/server/functions/admin-orders.functions";
import { ActionDialog } from "./ActionDialog";
import { adminTimeFormat } from "./ActivityLog";
import { BlockPhoneCard } from "./BlockPhoneCard";
import { OrderStatusBadge, PaymentBadge } from "./OrderList";
import { ADMIN_QUERY_KEY, invalidateProductData } from "./queries";

const PROGRESS_STEPS: readonly OrderStatus[] = ["new", "confirmed", "dispatched", "delivered"];

function whatsappLink(phone: string) {
  return `https://wa.me/88${phone}`;
}

function describeEvent(event: AdminOrderDetail["history"][number]) {
  const parts: string[] = [];
  if (event.fromStatus === null) parts.push("Order placed");
  else if (event.fromStatus !== event.toStatus)
    parts.push(`${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`);
  if (event.fromPaymentStatus !== null && event.fromPaymentStatus !== event.toPaymentStatus) {
    parts.push(
      `Payment ${PAYMENT_LABELS[event.fromPaymentStatus].toLowerCase()} → ${PAYMENT_LABELS[event.toPaymentStatus].toLowerCase()}`,
    );
  }
  if (!parts.length) parts.push("Note added");
  return parts.join(" · ");
}

function FulfillmentTracker({ status }: { status: OrderStatus }) {
  if (status === "cancelled") {
    return (
      <Alert variant="destructive">
        <XCircle />
        <AlertDescription>
          This order is cancelled and excluded from sales totals. You can reopen it in the Update panel.
        </AlertDescription>
      </Alert>
    );
  }
  const currentIndex = PROGRESS_STEPS.indexOf(status);
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <ol className="grid grid-cols-4 gap-2" aria-label="Order progress">
          {PROGRESS_STEPS.map((step, index) => {
            // Delivered is final, so its own step counts as done rather than in progress.
            const done = index < currentIndex || status === "delivered";
            const current = !done && index === currentIndex;
            return (
              <li key={step} className="grid gap-1.5" aria-current={current ? "step" : undefined}>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? "bg-success text-background"
                        : current
                          ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <span
                    className={`h-0.5 flex-1 rounded-full ${
                      index === PROGRESS_STEPS.length - 1 ? "bg-transparent" : done ? "bg-success" : "bg-border"
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <span className={`text-xs ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {STATUS_LABELS[step]}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export function OrderDetail({ order, isOwner }: { order: AdminOrderDetail; isOwner: boolean }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [payment, setPayment] = useState<PaymentStatus>(order.paymentStatus);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<{ text: string; conflict: boolean } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const next = STATUS_TRANSITIONS[order.status];
  const dirty = status !== order.status || payment !== order.paymentStatus || note.trim() !== "";
  const knownCost = order.lines.every((line) => line.costPrice !== null);
  // The coupon comes out of the margin, the same figure the dashboard's profit uses (orderSales).
  const margin =
    order.lines.reduce(
      (sum, line) => sum + (line.costPrice === null ? 0 : (line.unitPrice - line.costPrice) * line.qty),
      0,
    ) - order.couponDiscount;

  const save = useMutation({
    mutationFn: () =>
      updateOrderFn({ data: { id: order.id, version: order.version, status, paymentStatus: payment, note } }),
    onSuccess: async (result) => {
      setConfirmCancel(false);
      if (!result.ok) {
        setProblem({ text: result.error, conflict: Boolean(result.conflict) });
        return;
      }
      // The detail remounts on the new version with fresh state; lists and the activity log refetch.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "orders"] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "order", order.id] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] }),
        ...(status !== order.status
          ? [
              queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "coupons"] }),
              queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "stock-movements"] }),
              invalidateProductData(queryClient),
            ]
          : []),
      ]);
    },
    onError: (error) => {
      setConfirmCancel(false);
      setProblem({ text: error.message || "Could not save. Try again.", conflict: false });
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight tabular-nums">{order.reference}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed <time dateTime={order.createdAt}>{adminTimeFormat.format(new Date(order.createdAt))}</time> ·{" "}
            <span className="font-medium text-foreground">{formatPrice(order.total)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <OrderStatusBadge status={order.status} />
          <PaymentBadge status={order.paymentStatus} />
        </div>
      </div>

      <FulfillmentTracker status={order.status} />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <User aria-hidden="true" className="size-4 text-primary" />
                <CardTitle>Customer</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="text-base font-semibold text-foreground">{order.customerName}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-muted px-2.5 py-1 font-medium tabular-nums">
                  {formatPhone(order.phone)}
                </span>
                <Button size="sm" variant="outline" render={<a href={`tel:${order.phone}`} />}>
                  <Phone /> Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-success-border bg-success-soft text-success hover:bg-success-soft/80"
                  render={<a href={whatsappLink(order.phone)} target="_blank" rel="noreferrer" />}
                >
                  <MessageCircle /> WhatsApp
                </Button>
              </div>
              <div className="flex items-start gap-2.5 rounded-md bg-muted/40 p-3">
                <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Deliver to ({order.zoneName})</div>
                  <p className="mt-0.5 whitespace-pre-line text-foreground">{order.address}</p>
                </div>
              </div>
              {order.note ? (
                <div className="flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-soft/60 p-3">
                  <StickyNote aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <div className="text-xs font-medium text-warning">Customer note</div>
                    <p className="mt-0.5 whitespace-pre-line text-foreground">{order.note}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          {isOwner ? <BlockPhoneCard phone={order.phone} orderId={order.id} /> : null}
        </div>

        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle>Update order</CardTitle>
            <CardDescription>
              {next.length
                ? "Choose the next step, then save."
                : "Delivered orders are final; payment can still change."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (save.isPending) return;
                setProblem(null);
                if (status === "cancelled" && order.status !== "cancelled") {
                  setConfirmCancel(true);
                  return;
                }
                save.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-status`}>Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as OrderStatus)}>
                  <SelectTrigger id={`${id}-status`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={order.status}>{STATUS_LABELS[order.status]} (current)</SelectItem>
                    {next.map((value) => (
                      <SelectItem key={value} value={value}>
                        {STATUS_ACTIONS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-payment`}>Payment</Label>
                <Select value={payment} onValueChange={(value) => setPayment(value as PaymentStatus)}>
                  <SelectTrigger id={`${id}-payment`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PAYMENT_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-note`}>Note for the history (optional)</Label>
                <Textarea
                  id={`${id}-note`}
                  rows={2}
                  maxLength={300}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Called, delivery Thursday; bKash received"
                />
              </div>
              {problem ? (
                <Alert variant="destructive" role="alert">
                  <AlertCircle />
                  <AlertDescription>
                    {problem.text}
                    {problem.conflict ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() =>
                          queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "order", order.id] })
                        }
                      >
                        Reload order
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                disabled={!dirty || save.isPending}
                data-agent-confirm={
                  status === "cancelled" && order.status !== "cancelled"
                    ? `Cancels order ${order.reference} and removes it from sales`
                    : undefined
                }
              >
                <Save />
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </form>
          </CardContent>
          <ActionDialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title={`Cancel ${order.reference}?`}
            description="It will be removed from sales."
            confirmLabel="Cancel order"
            pendingLabel="Cancelling…"
            pending={save.isPending}
            destructive
            onConfirm={() => save.mutate()}
          />
        </Card>
      </div>

      <Card className="py-0">
        <CardHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Receipt aria-hidden="true" className="size-4 text-primary" />
            <CardTitle>Items &amp; totals</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Piece</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
                {isOwner ? <TableHead className="hidden text-right sm:table-cell">Cost</TableHead> : null}
                <TableHead className="pr-4 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map((line) => (
                <TableRow key={line.line}>
                  <TableCell className="max-w-[16rem] whitespace-normal pl-4">
                    <div className="font-medium text-foreground">{line.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.variantName}
                      {line.availability === "preorder" ? " · Pre-order" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatPrice(line.unitPrice)}
                    {isOwner && line.listPrice !== null && line.listPrice > line.unitPrice ? (
                      <div className="text-xs text-success">
                        Listed {formatPrice(line.listPrice)}, sale #{line.discountId}
                      </div>
                    ) : null}
                  </TableCell>
                  {isOwner ? (
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {line.costPrice === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatPrice(line.costPrice)
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="pr-4 text-right font-medium tabular-nums">
                    {formatPrice(line.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4 whitespace-normal" colSpan={2}>
                  {order.couponCode ? "Items" : "Subtotal"}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                {isOwner ? <TableCell className="hidden sm:table-cell" /> : null}
                <TableCell className="pr-4 text-right tabular-nums">
                  {formatPrice(order.couponCode ? order.itemsTotal : order.subtotal)}
                </TableCell>
              </TableRow>
              {order.couponCode ? (
                <TableRow>
                  <TableCell className="pl-4 whitespace-normal" colSpan={2}>
                    Coupon <span className="font-semibold text-success">{order.couponCode}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  {isOwner ? <TableCell className="hidden sm:table-cell" /> : null}
                  <TableCell className="pr-4 text-right font-medium text-success tabular-nums">
                    −{formatPrice(order.couponDiscount)}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableCell className="pl-4 whitespace-normal" colSpan={2}>
                  Delivery ({order.zoneName})
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                {isOwner ? <TableCell className="hidden sm:table-cell" /> : null}
                <TableCell className="pr-4 text-right tabular-nums">{formatPrice(order.deliveryCharge)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 whitespace-normal font-semibold" colSpan={2}>
                  Total to collect
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                {isOwner ? <TableCell className="hidden sm:table-cell" /> : null}
                <TableCell className="pr-4 text-right text-base font-bold tabular-nums">
                  {formatPrice(order.total)}
                </TableCell>
              </TableRow>
              {isOwner ? (
                <TableRow>
                  <TableCell className="pl-4 whitespace-normal text-muted-foreground" colSpan={2}>
                    Margin on items{order.couponCode ? " after the coupon" : ""}
                    {knownCost ? "" : " (some lines have no cost price)"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell
                    className={`pr-4 text-right font-semibold tabular-nums ${
                      margin >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {formatPrice(margin)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <History aria-hidden="true" className="size-4 text-primary" />
            <CardTitle>History</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="divide-y divide-border">
            {order.history.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{describeEvent(event)}</span>
                  <span className="text-muted-foreground"> · {event.actorUsername ?? "customer"}</span>
                  {event.note ? <span className="mt-0.5 block text-muted-foreground">{event.note}</span> : null}
                </span>
                <time className="text-xs text-muted-foreground tabular-nums" dateTime={event.createdAt}>
                  {adminTimeFormat.format(new Date(event.createdAt))}
                </time>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { adminTimeFormat } from "./ActivityLog";
import { OrderStatusBadge, PaymentBadge } from "./OrderList";
import { ADMIN_QUERY_KEY } from "./queries";

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

export function OrderDetail({ order, isOwner }: { order: AdminOrderDetail; isOwner: boolean }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [payment, setPayment] = useState<PaymentStatus>(order.paymentStatus);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<{ text: string; conflict: boolean } | null>(null);

  const next = STATUS_TRANSITIONS[order.status];
  const dirty = status !== order.status || payment !== order.paymentStatus || note.trim() !== "";
  const knownCost = order.lines.every((line) => line.costPrice !== null);
  const margin = order.lines.reduce(
    (sum, line) => sum + (line.costPrice === null ? 0 : (line.unitPrice - line.costPrice) * line.qty),
    0,
  );

  const save = useMutation({
    mutationFn: () =>
      updateOrderFn({ data: { id: order.id, version: order.version, status, paymentStatus: payment, note } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setProblem({ text: result.error, conflict: Boolean(result.conflict) });
        return;
      }
      // The detail remounts on the new version with fresh state; lists and the activity log refetch.
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });
    },
    onError: (error) => setProblem({ text: error.message || "Could not save. Try again.", conflict: false }),
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight tabular-nums">{order.reference}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed <time dateTime={order.createdAt}>{adminTimeFormat.format(new Date(order.createdAt))}</time> ·{" "}
            {formatPrice(order.total)}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <OrderStatusBadge status={order.status} />
          <PaymentBadge status={order.paymentStatus} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="font-medium text-foreground">{order.customerName}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{formatPhone(order.phone)}</span>
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${order.phone}`}>Call</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={whatsappLink(order.phone)} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </Button>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Deliver to ({order.zoneName})</div>
              <p className="whitespace-pre-line text-foreground">{order.address}</p>
            </div>
            {order.note ? (
              <div>
                <div className="text-xs text-muted-foreground">Customer note</div>
                <p className="whitespace-pre-line text-foreground">{order.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Update</CardTitle>
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
                setProblem(null);
                if (status === "cancelled" && order.status !== "cancelled") {
                  if (!window.confirm(`Cancel ${order.reference}? It will be removed from sales.`)) return;
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
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell className="pr-4 text-right tabular-nums">{formatPrice(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4 whitespace-normal" colSpan={isOwner ? 4 : 3}>
                  Subtotal
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{formatPrice(order.subtotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 whitespace-normal" colSpan={isOwner ? 4 : 3}>
                  Delivery ({order.zoneName})
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{formatPrice(order.deliveryCharge)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 whitespace-normal font-semibold" colSpan={isOwner ? 4 : 3}>
                  Total to collect
                </TableCell>
                <TableCell className="pr-4 text-right font-semibold tabular-nums">{formatPrice(order.total)}</TableCell>
              </TableRow>
              {isOwner ? (
                <TableRow>
                  <TableCell className="pl-4 whitespace-normal text-muted-foreground" colSpan={4}>
                    Margin on items{knownCost ? "" : " (some lines have no cost price)"}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">
                    {formatPrice(margin)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
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
                  {event.note ? <span className="block text-muted-foreground">{event.note}</span> : null}
                </span>
                <time className="text-muted-foreground tabular-nums" dateTime={event.createdAt}>
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

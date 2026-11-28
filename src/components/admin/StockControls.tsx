import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Boxes, History, Minus, PauseCircle, PlayCircle, Plus } from "lucide-react";
import { useId, useState } from "react";
import {
  type AdjustStockInput,
  LOW_STOCK_LIMIT,
  MAX_STOCK_QUANTITY,
  STOCK_REASON_LABELS,
  type StockMovement,
} from "@/domain/stock";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustStockFn, stopCountingFn } from "@/server/functions/admin-stock.functions";
import { adminTimeFormat } from "./ActivityLog";
import { ActionDialog } from "./ActionDialog";
import { ADMIN_QUERY_KEY, adminStockMovementsQuery, invalidateProductData } from "./queries";

type StockAction = AdjustStockInput["action"];

const DIALOG_TEXT: Record<StockAction, { title: string; confirm: string; pending: string }> = {
  start: { title: "Start counting", confirm: "Start counting", pending: "Saving…" },
  in: { title: "Stock in", confirm: "Add stock", pending: "Adding…" },
  out: { title: "Stock out", confirm: "Remove stock", pending: "Removing…" },
};

const STOP_TEXT = { title: "Stop counting", confirm: "Stop counting", pending: "Saving…" };

/**
 * One colour's count with its buttons. The count has its own save: it never goes through the product form, so a
 * stock change never conflicts with an unsaved edit. A colour that is not counted keeps its manual availability.
 */
export function StockControls({
  productId,
  variantId,
  colour,
  stock,
}: {
  productId: number;
  variantId: number;
  colour: string;
  stock: number | null;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<StockAction | "stop" | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const close = () => {
    setAction(null);
    setQuantity("");
    setNote("");
    setError(null);
  };

  const adjust = useMutation({
    mutationFn: (input: AdjustStockInput) => adjustStockFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarning(result.warning ?? null);
      close();
      // The count and availability come back with the product; the history and the list's counts refetch.
      await Promise.all([
        invalidateProductData(queryClient),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "stock-movements", productId] }),
      ]);
    },
    onError: (failure) => setError(failure.message || "Could not save. Check your connection and try again."),
  });

  const stop = useMutation({
    mutationFn: () => stopCountingFn({ data: { productId, variantId } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarning(result.warning ?? null);
      close();
      await Promise.all([
        invalidateProductData(queryClient),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "stock-movements", productId] }),
      ]);
    },
    onError: (failure) => setError(failure.message || "Could not save. Check your connection and try again."),
  });

  const parsed = quantity.trim() === "" ? null : Number(quantity);
  const valid =
    parsed !== null &&
    Number.isInteger(parsed) &&
    parsed <= MAX_STOCK_QUANTITY &&
    parsed >= (action === "start" ? 0 : 1) &&
    (action !== "out" || stock === null || parsed <= stock);

  function confirm() {
    if (action === "stop") {
      setError(null);
      stop.mutate();
      return;
    }
    if (!action || parsed === null || !valid) {
      setError(
        action === "out" && stock !== null && parsed !== null && parsed > stock
          ? `Only ${stock} in stock.`
          : "Enter a whole number" + (action === "start" ? "." : " of at least 1."),
      );
      return;
    }
    setError(null);
    adjust.mutate({ productId, variantId, action, quantity: parsed, note });
  }

  const text = action === "stop" ? STOP_TEXT : action ? DIALOG_TEXT[action] : DIALOG_TEXT.in;
  const stockVariant =
    stock === null ? "outline" : stock <= 0 ? "destructive" : stock <= LOW_STOCK_LIMIT ? "warning" : "success";

  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Boxes aria-hidden="true" className="size-4 text-muted-foreground" />
          Stock
        </span>
        {stock === null ? (
          <>
            <span className="text-sm text-muted-foreground">Not counted. Availability is set by hand.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setAction("start")}>
              <PlayCircle /> Start counting
            </Button>
          </>
        ) : (
          <>
            <Badge variant={stockVariant} className="tabular-nums" aria-label={`${colour} stock`}>
              {/* One text node: a flex badge drops the whitespace-only node between two expressions ("6in stock"). */}
              {`${stock} ${stock <= 0 ? "out of stock" : stock <= LOW_STOCK_LIMIT ? "low" : "in stock"}`}
            </Badge>
            <Button type="button" size="sm" variant="outline" onClick={() => setAction("in")}>
              <Plus /> Stock in
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={stock <= 0} onClick={() => setAction("out")}>
              <Minus /> Stock out
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAction("stop")}>
              <PauseCircle /> Stop counting
            </Button>
          </>
        )}
      </div>
      {warning ? (
        <p role="status" className="text-sm text-muted-foreground">
          {warning}
        </p>
      ) : null}
      <ActionDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={`${text.title}: ${colour}`}
        description={
          action === "stop"
            ? "The count is dropped and availability is set by hand from now on. It stays as it is today until you change it in the editor. Orders already placed are not affected."
            : action === "start"
              ? "Set how many are on the shelf now. From then on the colour is in stock above 0 and out of stock at 0, and orders take from the count."
              : action === "out"
                ? "Remove pieces that left without an order (damaged, gifted, lost). A count never goes below 0."
                : "Add pieces that arrived. Availability updates with the count."
        }
        confirmLabel={text.confirm}
        pendingLabel={text.pending}
        pending={adjust.isPending || stop.isPending}
        onConfirm={confirm}
      >
        <div className="grid gap-3">
          {action === "stop" ? null : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-qty`}>{action === "start" ? "Pieces on hand" : "Quantity"}</Label>
                <Input
                  id={`${id}-qty`}
                  type="number"
                  inputMode="numeric"
                  min={action === "start" ? 0 : 1}
                  max={MAX_STOCK_QUANTITY}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-note`}>Note (optional)</Label>
                <Input
                  id={`${id}-note`}
                  value={note}
                  maxLength={200}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </>
          )}
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </ActionDialog>
    </div>
  );
}

function describeMovement(movement: StockMovement) {
  const sign = movement.delta > 0 ? "+" : "";
  return `${sign}${movement.delta}`;
}

/** The last movements of a product, 50 at a time. Orders link to their detail page. */
export function StockHistory({ productId }: { productId: number }) {
  const history = useInfiniteQuery(adminStockMovementsQuery(productId));
  const movements = history.data?.pages.flatMap((page) => page.movements) ?? [];

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <History aria-hidden="true" className="size-4 text-primary" />
          <CardTitle>Stock history</CardTitle>
        </div>
        <CardDescription>
          Every change to a counted colour, newest first, in Bangladesh time. Colour names are as they were then.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {history.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {history.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{history.error.message || "Could not load the stock history."}</AlertDescription>
          </Alert>
        ) : null}
        {history.data && movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock changes yet. Start counting a colour above.</p>
        ) : null}
        {movements.length ? (
          <ul className="divide-y divide-border text-sm">
            {movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{movement.variantName}</span>{" "}
                  <span className="text-muted-foreground">
                    {STOCK_REASON_LABELS[movement.reason]}
                    {movement.orderId ? (
                      <>
                        {" · "}
                        <Link
                          to="/admin/orders/$orderId"
                          params={{ orderId: movement.orderId }}
                          className="text-primary underline hover:text-primary/80"
                        >
                          order
                        </Link>
                      </>
                    ) : null}
                    {movement.actorUsername ? ` · ${movement.actorUsername}` : ""}
                    {movement.note ? ` · ${movement.note}` : ""}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 tabular-nums">
                  <Badge variant={movement.delta < 0 ? "destructive" : "success"}>{describeMovement(movement)}</Badge>
                  <span className="text-muted-foreground">now {movement.balanceAfter}</span>
                  <time dateTime={movement.createdAt} className="text-xs text-muted-foreground">
                    {adminTimeFormat.format(new Date(movement.createdAt))}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {history.hasNextPage ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

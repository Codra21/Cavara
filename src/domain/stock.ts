// Stock counts and movements: rules shared by checkout, the admin and the server functions. Pure: no React, no D1.
// The SQL lives in src/server/db/stock.repository.ts; its statements repeat the availability rule below.
import { z } from "zod";
import type { Availability } from "@/lib/types";

/** A counted colour with this many or fewer left (or none) is "low stock" in the admin product list. */
export const LOW_STOCK_LIMIT = 3;

/** One stock in, out or first count. 100,000 is far beyond a shop of this size and keeps sums inside safe integers. */
export const MAX_STOCK_QUANTITY = 100_000;

export const STOCK_REASONS = ["stock_in", "stock_out", "order", "order_cancel", "order_reopen", "correction"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const STOCK_REASON_LABELS: Record<StockReason, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  order: "Order placed",
  order_cancel: "Order cancelled",
  order_reopen: "Order reopened",
  correction: "First count",
};

export const STOCK_MOVEMENT_PAGE_SIZE = 50;

/**
 * Availability a counted colour gets from its count. A colour on pre-order stays on pre-order at any count; every
 * other counted colour is in stock above 0 and out of stock at 0 or below. `null` (not counted) keeps `current`.
 */
export function availabilityFromStock(stock: number | null, current: Availability): Availability {
  if (stock === null || current === "preorder") return current;
  return stock > 0 ? "in_stock" : "out_of_stock";
}

/** True when a count (or a change of count) changes what the shop shows for the colour. */
export function crossesZero(before: number, after: number): boolean {
  return before > 0 !== after > 0;
}

export interface StockLine {
  productName: string;
  variantName: string;
  availability: Availability;
  stock: number | null;
  qty: number;
}

/** A line the shop cannot fill: counted, not on pre-order, and holding fewer than the shopper wants. */
export function isShort(line: Pick<StockLine, "availability" | "stock" | "qty">): boolean {
  return line.availability !== "preorder" && line.stock !== null && line.stock < line.qty;
}

/** Shopper-facing refusal for a short line: "only N left" when some remain. */
export function shortageMessage(line: Pick<StockLine, "productName" | "variantName" | "stock">): string {
  const name = `${line.productName} (${line.variantName})`;
  return line.stock !== null && line.stock > 0
    ? `${name}: only ${line.stock} left. Lower the quantity in your cart and send the order again.`
    : `${name} is no longer available. Remove it from your cart and send the order again.`;
}

const note = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().max(200, "Keep the note under 200 characters"));

export const adjustStockSchema = z
  .object({
    productId: z.number().int().positive(),
    variantId: z.number().int().positive(),
    /** `start` sets the first count of an uncounted colour; `in` and `out` change a counted one. */
    action: z.enum(["start", "in", "out"]),
    quantity: z.number().int().min(0).max(MAX_STOCK_QUANTITY),
    note,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.action !== "start" && input.quantity < 1) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity of at least 1" });
    }
  });

export type AdjustStockInput = z.output<typeof adjustStockSchema>;

/** Stop counting one colour: its stock goes back to NULL and its availability stays as it is. */
export const stopCountingSchema = z
  .object({ productId: z.number().int().positive(), variantId: z.number().int().positive() })
  .strict();

export type StopCountingInput = z.output<typeof stopCountingSchema>;

export type StopCountingResult = { ok: true } | { ok: false; error: string };

export const stockMovementsSchema = z.object({
  productId: z.number().int().positive(),
  /** Keyset cursor: the last row of the previous page. */
  after: z
    .object({ createdAt: z.string().max(40), id: z.number().int().positive() })
    .nullable()
    .default(null),
});

export interface StockMovement {
  id: number;
  variantId: number;
  variantName: string;
  delta: number;
  reason: StockReason;
  orderId: string | null;
  note: string;
  actorUsername: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface StockMovementPage {
  movements: StockMovement[];
  next: { createdAt: string; id: number } | null;
}

export type AdjustStockResult =
  | { ok: true; stock: number; availability: Availability; warning?: string }
  | { ok: false; error: string };

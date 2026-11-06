// Guest order submission. Server-only; takes the database and request facts as arguments so tests run on bun:sqlite.
//
// One submission, in order:
//   1. Validate (Zod). A filled honeypot is rejected like a validation error.
//   2. Replay: the same idempotency key with the same order returns the saved reference (a retried tap, a lost
//      response). The same key with a different order is refused.
//   3. Rate limits per client IP and per phone number (HMAC keys, 15-minute windows).
//   4. Re-read prices, availability and the delivery zone from D1. The client's prices are never charged: a mismatch
//      returns the current prices for the shopper to review.
//   5. Save everything in one D1 batch (one transaction). A race on the idempotency key resolves to a replay.
// Telegram alerts (unit 8) are written to an outbox after the order commits, so a failed alert never loses an order.
import { createHash, createHmac } from "node:crypto";
import {
  canonicalCheckout,
  checkoutFieldErrors,
  checkoutSchema,
  newReference,
  ORDER_LIMIT_WINDOW_MS,
  ORDER_LIMITS,
  shopDay,
  type SubmitOrderResult,
} from "@/domain/orders";
import type { D1Database } from "@/server/db/d1";
import {
  consumeOrderLimits,
  findOrderByIdempotencyKey,
  insertOrder,
  readActiveZone,
  readSelections,
  type Selection,
} from "@/server/db/orders.repository";

export interface SubmitContext {
  /** Client IP (cf-connecting-ip) or a stand-in in local dev. */
  client: string;
  /** ORDER_RATE_LIMIT_SECRET. */
  limitSecret: string;
  now?: Date;
  newId?: () => string;
  newReference?: () => string;
}

const FAILED: SubmitOutcome = {
  ok: false,
  code: "failed",
  message: "Your order could not be saved. Your bag is unchanged. Please try again, or message us on WhatsApp.",
};

const CONFLICT: SubmitOutcome = {
  ok: false,
  code: "idempotency_conflict",
  message: "This checkout was already sent with different details. Review your bag and send it again.",
};

const isUnique = (error: unknown, column: string) =>
  new RegExp(`UNIQUE constraint failed: orders\\.${column}`, "i").test(
    error instanceof Error ? error.message : String(error),
  );

/** The public result plus, on success, the order id for the server-side alert (never sent to the shopper). */
export type SubmitOutcome =
  | Exclude<SubmitOrderResult, { ok: true }>
  | (Extract<SubmitOrderResult, { ok: true }> & { orderId: string });

export async function submitOrder(db: D1Database, raw: unknown, context: SubmitContext): Promise<SubmitOutcome> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation",
      message: "Please check the highlighted fields.",
      fieldErrors: checkoutFieldErrors(parsed.error.issues),
    };
  }
  const input = parsed.data;
  if (input.website) {
    return { ok: false, code: "validation", message: "Your order could not be accepted.", fieldErrors: {} };
  }

  const payloadHash = createHash("sha256")
    .update(`order:v1:${canonicalCheckout(input)}`)
    .digest("hex");
  const replay = await findOrderByIdempotencyKey(db, input.idempotencyKey);
  if (replay) {
    return replay.payload_hash === payloadHash
      ? { ok: true, reference: replay.reference, total: replay.total, replayed: true, orderId: replay.id }
      : CONFLICT;
  }

  const now = context.now ?? new Date();
  const limitKey = (kind: string, value: string) =>
    createHmac("sha256", context.limitSecret).update(`cavara-order:${kind}:${value}`).digest("hex");
  const withinLimits = await consumeOrderLimits(
    db,
    [
      { key: limitKey("ip", context.client), max: ORDER_LIMITS.ip },
      { key: limitKey("phone", input.phone), max: ORDER_LIMITS.phone },
    ],
    now.getTime(),
    ORDER_LIMIT_WINDOW_MS,
  );
  if (!withinLimits) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Too many orders from this number or connection. Please wait 15 minutes, or message us on WhatsApp.",
    };
  }

  const [selections, zone] = await Promise.all([readSelections(db, input.items), readActiveZone(db, input.zoneId)]);
  if (!zone) {
    return {
      ok: false,
      code: "validation",
      message: "That delivery area is no longer available.",
      fieldErrors: { zoneId: "Choose a delivery area" },
    };
  }

  const lines: (Selection & { qty: number })[] = [];
  for (const item of input.items) {
    const selection = selections.get(`${item.productId}:${item.variant}`);
    if (!selection || selection.status !== "published" || selection.availability === "out_of_stock") {
      const name = selection ? `${selection.productName} (${selection.variantName})` : "A piece in your bag";
      return {
        ok: false,
        code: "unavailable",
        message: `${name} is no longer available. Remove it from your bag and send the order again.`,
      };
    }
    lines.push({ ...selection, qty: item.qty });
  }

  const priceChanged = input.items.some((item, index) => lines[index]!.unitPrice !== item.unitPrice);
  if (priceChanged || zone.charge !== input.deliveryCharge) {
    return {
      ok: false,
      code: "price_changed",
      message: "Some prices changed since you opened the shop. Check the new total, then send the order again.",
      prices: lines.map((line) => ({ productId: line.productId, variant: line.variant, unitPrice: line.unitPrice })),
      deliveryCharge: zone.charge,
    };
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const total = subtotal + zone.charge;
  const base = {
    id: (context.newId ?? (() => crypto.randomUUID()))(),
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    input,
    zone,
    lines,
    subtotal,
    total,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    shopDay: shopDay(now),
    createdAt: now.toISOString(),
  };

  const makeReference = context.newReference ?? (() => newReference());
  // A reference collision (about 1 in 887 million per pair) gets one retry with a fresh reference.
  for (let attempt = 0; attempt < 2; attempt++) {
    const reference = makeReference();
    try {
      await insertOrder(db, { ...base, reference });
      return { ok: true, reference, total, replayed: false, orderId: base.id };
    } catch (error) {
      if (isUnique(error, "idempotency_key")) {
        const saved = await findOrderByIdempotencyKey(db, input.idempotencyKey);
        if (saved?.payload_hash === payloadHash) {
          return { ok: true, reference: saved.reference, total: saved.total, replayed: true, orderId: saved.id };
        }
        return saved ? CONFLICT : FAILED;
      }
      if (isUnique(error, "reference") && attempt === 0) continue;
      throw error;
    }
  }
  return FAILED;
}

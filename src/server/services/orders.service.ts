// Guest order submission. Server-only; takes the database and request facts as arguments so tests run on bun:sqlite.
//
// One submission, in order:
//   1. Validate (Zod). A filled honeypot is rejected like a validation error.
//   2. Replay: the same idempotency key with the same order returns the saved reference (a retried tap, a lost
//      response). The same key with a different order is refused.
//   3. A blocked phone gets its own refusal (PHONE_BLOCKED) and a phone with MAX_OPEN_ORDERS orders still 'new' gets the
//      open-order refusal. Both are read first, so nothing is written. Then rate limits per client IP and per phone
//      number (HMAC keys, 15-minute windows).
//   4. Re-read prices, availability, the live sales and the delivery zone from D1. The charged price is the list price
//      less the best sale (src/domain/discounts.ts, the rule the shop's cards use). The client's prices are never
//      charged: a mismatch returns the current prices for the shopper to review.
//   5. A coupon code is re-checked against the item total after sales (src/domain/coupons.ts). A coupon that stopped
//      applying, or whose discount changed, returns price_changed with the coupon's new answer, like a changed price.
//   6. Save everything in one D1 batch (one transaction), taking counted colours out of stock. The order insert is
//      conditional on the colour still existing, its product still being published, and the stock still being there,
//      so a colour that sold out or disappeared since step 4 saves nothing and the shopper gets the unavailable
//      refusal. The same batch claims a use of the coupon, and the order insert needs the use to be there, so the
//      loser of a race for the last use saves nothing and gets price_changed with the coupon's
//      new answer. The same insert needs the phone to be unblocked and under the open-order cap, so concurrent
//      submits cannot pass either check. A race on the idempotency key resolves to a replay, which claims nothing.
// Telegram alerts (unit 8) are written to an outbox after the order commits, so a failed alert never loses an order.
import { createHash, createHmac } from "node:crypto";
import {
  calculateDeliveryCharge,
  calculateTotalWeightG,
  canonicalCheckout,
  type CheckoutInput,
  checkoutFieldErrors,
  checkoutSchema,
  newReference,
  ORDER_LIMIT_WINDOW_MS,
  ORDER_LIMITS,
  shopDay,
  MAX_OPEN_ORDERS,
  type SubmitOrderResult,
} from "@/domain/orders";
import { type CouponAnswer, type CouponRule, couponMessage, evaluateCoupon } from "@/domain/coupons";
import { bestSale } from "@/domain/discounts";
import { rateLimitSubject } from "@/domain/rate-limit-subject";
import { isShort, shortageMessage } from "@/domain/stock";
import type { D1Database } from "@/server/db/d1";
import { readLiveSales } from "@/server/db/catalog.repository";
import { readCrossedProducts } from "@/server/db/stock.repository";
import {
  consumeOrderLimits,
  findOrderByIdempotencyKey,
  insertOrder,
  readActiveZone,
  readCouponByCode,
  readPhoneStanding,
  type OrderLine,
  readSelections,
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
  message: "Your order could not be saved. Your cart is unchanged. Please try again, or message us on WhatsApp.",
};

// A blocked number gets its own answer: the rate-limit one told the shopper to wait 15 minutes, which never helps.
// It does not say "blocked"; it points to WhatsApp, where staff can sort out a number blocked by mistake.
const PHONE_BLOCKED: SubmitOutcome = {
  ok: false,
  code: "phone_blocked",
  message: "We can't take online orders from this number. Please message us on WhatsApp to place your order.",
};

const RATE_LIMITED: SubmitOutcome = {
  ok: false,
  code: "rate_limited",
  message: "Too many orders from this number or connection. Please wait 15 minutes, or message us on WhatsApp.",
};

const OPEN_ORDERS: SubmitOutcome = {
  ok: false,
  code: "open_orders",
  message: `You already have ${MAX_OPEN_ORDERS} orders waiting for our call. We'll contact you soon; reply to us if you need to change them.`,
};

const CONFLICT: SubmitOutcome = {
  ok: false,
  code: "idempotency_conflict",
  message: "This checkout was already sent with different details. Review your cart and send it again.",
};

/**
 * The shopper-facing answer for a code and an item total: the discount, or why the code does not apply. Only the
 * minimum order is explained, because it is something the shopper can act on. Every other refusal (unknown, switched
 * off, expired, not started, used up, no discount) gets the same answer, so a guess cannot tell a real code that has
 * ended from a code that does not exist.
 */
export function couponAnswer(rule: CouponRule | null, code: string, itemsTotal: number, nowMs: number): CouponAnswer {
  const evaluation = evaluateCoupon(rule, itemsTotal, nowMs);
  if (evaluation.ok) return { ...evaluation, code };
  if (evaluation.reason === "min_order") return evaluation;
  return { ok: false, reason: "unknown", message: couponMessage("unknown") };
}

/** Said when only the coupon changed: why it no longer applies, or what its discount is now. */
const couponChangedMessage = (coupon: CouponAnswer) =>
  coupon.ok
    ? "Your coupon discount changed. Check the new total, then send the order again."
    : `${coupon.message} Your total no longer includes it.`;

export const orderLimitKey = (secret: string, kind: string, value: string) =>
  createHmac("sha256", secret).update(`cavara-order:${kind}:${value}`).digest("hex");

const isUnique = (error: unknown, column: string) =>
  new RegExp(`UNIQUE constraint failed: orders\\.${column}`, "i").test(
    error instanceof Error ? error.message : String(error),
  );

/**
 * The public result plus, on success, what only the server needs: the order id for the alert and the products whose
 * colours sold out with this order, so the shop's copy of them can be patched after the reply.
 */
export type SubmitOutcome =
  | Exclude<SubmitOrderResult, { ok: true }>
  | (Extract<SubmitOrderResult, { ok: true }> & { orderId: string; soldOutProducts?: number[] });

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
  // Before the rate limits, so a blocked or capped number writes nothing at all (not even a limit counter).
  const standing = await readPhoneStanding(db, input.phone);
  if (standing.blocked) return PHONE_BLOCKED;
  if (standing.openOrders >= MAX_OPEN_ORDERS) return OPEN_ORDERS;
  const limitKey = (kind: string, value: string) => orderLimitKey(context.limitSecret, kind, value);
  const withinLimits = await consumeOrderLimits(
    db,
    [
      { key: limitKey("ip", rateLimitSubject(context.client)), max: ORDER_LIMITS.ip },
      { key: limitKey("phone", input.phone), max: ORDER_LIMITS.phone },
    ],
    now.getTime(),
    ORDER_LIMIT_WINDOW_MS,
  );
  if (!withinLimits) return RATE_LIMITED;

  const [selections, zone, sales] = await Promise.all([
    readSelections(db, input.items),
    readActiveZone(db, input.zoneId),
    readLiveSales(db, now),
  ]);
  if (!zone) {
    return {
      ok: false,
      code: "validation",
      message: "That delivery area is no longer available.",
      fieldErrors: { zoneId: "Choose a delivery area" },
    };
  }

  const lines: OrderLine[] = [];
  for (const item of input.items) {
    const selection = selections.get(`${item.productId}:${item.variant}`);
    if (!selection || selection.status !== "published" || selection.availability !== "in_stock") {
      const name = selection ? `${selection.productName} (${selection.variantName})` : "A piece in your cart";
      const message =
        selection?.availability === "preorder"
          ? `${name} is pre-order only. Request it on WhatsApp, and remove it from your cart to place this order.`
          : `${name} is no longer available. Remove it from your cart and send the order again.`;
      return { ok: false, code: "unavailable", message };
    }
    // A counted colour with fewer left than asked for ("only N left"); the order insert re-checks this atomically.
    if (isShort({ ...selection, qty: item.qty })) {
      return { ok: false, code: "unavailable", message: shortageMessage(selection) };
    }
    const sale = bestSale(
      sales,
      { id: selection.productId, category: selection.category },
      selection.unitPrice,
      now.getTime(),
    );
    lines.push({
      ...selection,
      qty: item.qty,
      unitPrice: sale?.price ?? selection.unitPrice,
      listPrice: selection.unitPrice,
      discountId: sale?.rule.id ?? null,
    });
  }

  const itemsTotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const totalWeightG = calculateTotalWeightG(lines);
  const deliveryCharge = calculateDeliveryCharge(zone, totalWeightG);
  const couponRule = input.couponCode ? await readCouponByCode(db, input.couponCode) : null;
  const coupon = input.couponCode ? couponAnswer(couponRule, input.couponCode, itemsTotal, now.getTime()) : null;
  const couponChanged =
    coupon !== null ? !coupon.ok || coupon.discount !== input.couponDiscount : input.couponDiscount !== 0;

  const priceChanged = input.items.some((item, index) => lines[index]!.unitPrice !== item.unitPrice);
  if (priceChanged || deliveryCharge !== input.deliveryCharge || couponChanged) {
    return {
      ok: false,
      code: "price_changed",
      message:
        coupon !== null && couponChanged && !priceChanged && deliveryCharge === input.deliveryCharge
          ? couponChangedMessage(coupon)
          : "Some prices changed since you opened the shop. Check the new total, then send the order again.",
      prices: lines.map((line) => ({ productId: line.productId, variant: line.variant, unitPrice: line.unitPrice })),
      deliveryCharge,
      coupon,
    };
  }

  const discount = coupon?.ok ? coupon.discount : 0;
  const subtotal = itemsTotal - discount;
  const total = subtotal + deliveryCharge;
  const base = {
    id: (context.newId ?? (() => crypto.randomUUID()))(),
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    input,
    zone,
    deliveryCharge,
    totalWeightG,
    lines,
    itemsTotal,
    coupon: coupon?.ok && couponRule ? { id: couponRule.id, code: coupon.code, discount } : null,
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
      const placed = await insertOrder(db, { ...base, reference });
      if (!placed) return refusedAfterRead(db, input, { zone, itemsTotal, lines, now });
      // Counted colours this order took to 0 or below stop being in stock; read from the written movements so
      // concurrent stock changes between readSelections and insertOrder cannot leave R2 snapshots stale.
      const nonPreorder = new Set(
        lines.filter((line) => line.availability !== "preorder").map((line) => line.productId),
      );
      const soldOutProducts =
        nonPreorder.size > 0
          ? (await readCrossedProducts(db, base.id, base.createdAt)).filter((id) => nonPreorder.has(id))
          : [];
      return { ok: true, reference, total, replayed: false, orderId: base.id, soldOutProducts };
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

/**
 * The order insert saved nothing: a colour or its product disappeared, a counted colour ran short, or the coupon's
 * last use went to another order, after they were read. Say which, as the first checks do.
 */
async function refusedAfterRead(
  db: D1Database,
  input: CheckoutInput,
  read: { zone: { charge: number }; itemsTotal: number; lines: OrderLine[]; now: Date },
): Promise<SubmitOutcome> {
  // The insert also refuses a phone that was blocked or reached the cap after the first read.
  const standing = await readPhoneStanding(db, input.phone);
  if (standing.blocked) return PHONE_BLOCKED;
  if (standing.openOrders >= MAX_OPEN_ORDERS) return OPEN_ORDERS;
  const selections = await readSelections(db, input.items);
  for (const item of input.items) {
    const selection = selections.get(`${item.productId}:${item.variant}`);
    // A missing colour, or a product that is no longer published, is the same answer as the first check.
    if (!selection || selection.status !== "published") {
      const name = selection ? `${selection.productName} (${selection.variantName})` : "A piece in your cart";
      return {
        ok: false,
        code: "unavailable",
        message: `${name} is no longer available. Remove it from your cart and send the order again.`,
      };
    }
    if (selection.availability === "out_of_stock" || isShort({ ...selection, qty: item.qty })) {
      return { ok: false, code: "unavailable", message: shortageMessage(selection) };
    }
  }
  if (!input.couponCode) return FAILED;
  const coupon = couponAnswer(
    await readCouponByCode(db, input.couponCode),
    input.couponCode,
    read.itemsTotal,
    read.now.getTime(),
  );
  // A coupon that still applies as the shopper saw it means the failure was something else.
  if (coupon.ok && coupon.discount === input.couponDiscount) return FAILED;
  return {
    ok: false,
    code: "price_changed",
    message: couponChangedMessage(coupon),
    prices: read.lines.map((line) => ({ productId: line.productId, variant: line.variant, unitPrice: line.unitPrice })),
    deliveryCharge: read.zone.charge,
    coupon,
  };
}

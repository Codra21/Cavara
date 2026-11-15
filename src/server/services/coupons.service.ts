// The public "Have a code?" check. Server-only; takes the database and request facts as arguments so tests run on
// bun:sqlite. It answers what a submission would: the same item total after sales, the same coupon rule.
//
// Every call counts against a per-IP limit in the order rate-limit table, under its own key kind, so a code cannot be
// guessed by calling this over and over. A valid code costs one coupon row read (UNIQUE index on discounts.code) plus
// the bag's own lookups, which are primary-key reads of at most 30 lines.
import { couponCheckSchema, type CouponCheckResult, couponMessage, normalizeCouponCode } from "@/domain/coupons";
import { ORDER_LIMIT_WINDOW_MS, ORDER_LIMITS } from "@/domain/orders";
import { bestSale } from "@/domain/discounts";
import type { D1Database } from "@/server/db/d1";
import { readLiveSales } from "@/server/db/catalog.repository";
import { consumeOrderLimits, readCouponByCode, readSelections } from "@/server/db/orders.repository";
import { couponAnswer, orderLimitKey } from "./orders.service";

export interface CouponCheckContext {
  /** Client IP (cf-connecting-ip) or a stand-in in local dev. */
  client: string;
  /** ORDER_RATE_LIMIT_SECRET. */
  limitSecret: string;
  now?: Date;
}

export async function checkCoupon(
  db: D1Database,
  raw: unknown,
  context: CouponCheckContext,
): Promise<CouponCheckResult> {
  const parsed = couponCheckSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "failed", message: "That code could not be checked. Try again." };
  const { items } = parsed.data;
  const now = context.now ?? new Date();

  const withinLimit = await consumeOrderLimits(
    db,
    [{ key: orderLimitKey(context.limitSecret, "coupon-ip", context.client), max: ORDER_LIMITS.couponIp }],
    now.getTime(),
    ORDER_LIMIT_WINDOW_MS,
  );
  if (!withinLimit) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many codes tried. Please wait 15 minutes, or message us on WhatsApp.",
    };
  }

  const code = normalizeCouponCode(parsed.data.code);
  if (!code) return { ok: false, reason: "unknown", message: couponMessage("unknown") };

  const [rule, selections, sales] = await Promise.all([
    readCouponByCode(db, code),
    readSelections(db, items),
    readLiveSales(db, now),
  ]);
  // Price the lines that exist and are for sale. The submission refuses the others, so the shopper never reaches it.
  let itemsTotal = 0;
  for (const item of items) {
    const selection = selections.get(`${item.productId}:${item.variant}`);
    if (!selection || selection.status !== "published") continue;
    const sale = bestSale(
      sales,
      { id: selection.productId, category: selection.category },
      selection.unitPrice,
      now.getTime(),
    );
    itemsTotal += (sale?.price ?? selection.unitPrice) * item.qty;
  }
  return couponAnswer(rule, code, itemsTotal, now.getTime());
}

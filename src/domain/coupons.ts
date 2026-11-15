// Checkout coupons (P9.3). Pure: no React, no D1, no fetch. Checkout, the code check and the admin form share it.
//
// Rules:
// - A coupon applies to the item total AFTER sales (the sum of the charged prices), once per order.
// - A percent coupon takes floor(itemsTotal * value / 100) off, capped at maxDiscount when the coupon has one. An
//   amount coupon takes `value` off. Either way the order never drops below 1 taka, so `orders.subtotal > 0` holds.
// - It applies when it is active, startsAt <= now < endsAt (endsAt null = no end date), usedCount < usageLimit
//   (null = unlimited) and the item total after sales reaches minOrder.
// - Cancelling an order that was never paid gives its use back, and reopening it takes a use again (refused when none
//   is left). A paid or refunded order keeps its use. The rule lives in updateOrderStatus.
import { z } from "zod";
import { formatPrice } from "@/domain/catalog";
import { DISCOUNT_TYPES, isoDate, isSaleActive } from "@/domain/discounts";

export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{3,20}$/;

/** Upper case and trimmed; null when the result is not 3 to 20 of A-Z, 0-9 and "-". */
export function normalizeCouponCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return COUPON_CODE_PATTERN.test(code) ? code : null;
}

/** What the rule needs: the coupon row without its name. Money is whole BDT. */
export interface CouponRule {
  id: number;
  code: string;
  type: "percent" | "amount";
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string | null;
}

export type CouponReason = "unknown" | "not_started" | "expired" | "used_up" | "min_order" | "no_discount";

export type CouponEvaluation =
  | { ok: true; discount: number; itemsTotal: number; subtotal: number }
  | { ok: false; reason: CouponReason; message: string };

/** What the shopper is told. Everything but the minimum order reads the same, so a dead code reveals nothing. */
export const couponMessage = (reason: CouponReason, minOrder?: number | null): string => {
  switch (reason) {
    // One text for every refusal a stranger could use to learn that a code exists (see couponAnswer).
    case "unknown":
    case "not_started":
    case "expired":
    case "used_up":
      return "This code isn't valid right now.";
    case "min_order":
      return `This code needs at least ${formatPrice(minOrder ?? 0)} in items, after any sale prices.`;
    case "no_discount":
      return "This code isn't valid right now.";
  }
};

const refuse = (reason: CouponReason, minOrder?: number | null): CouponEvaluation => ({
  ok: false,
  reason,
  message: couponMessage(reason, minOrder),
});

/** The discount for an item total, before the date, limit and minimum checks. Never leaves less than 1 taka. */
export function couponAmount(itemsTotal: number, rule: Pick<CouponRule, "type" | "value" | "maxDiscount">): number {
  let off = rule.type === "percent" ? Math.floor((itemsTotal * rule.value) / 100) : rule.value;
  if (rule.type === "percent" && rule.maxDiscount !== null) off = Math.min(off, rule.maxDiscount);
  return Math.max(0, Math.min(off, itemsTotal - 1));
}

/** `rule` is null when no row has the code. `itemsTotal` is the sum of the charged (after sale) line totals. */
export function evaluateCoupon(rule: CouponRule | null, itemsTotal: number, nowMs: number): CouponEvaluation {
  if (!rule || !rule.active) return refuse("unknown");
  if (Date.parse(rule.startsAt) > nowMs) return refuse("not_started");
  if (!isSaleActive(rule, nowMs)) return refuse("expired");
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) return refuse("used_up");
  if (rule.minOrder !== null && itemsTotal < rule.minOrder) return refuse("min_order", rule.minOrder);
  const discount = couponAmount(itemsTotal, rule);
  if (discount < 1) return refuse("no_discount");
  return { ok: true, discount, itemsTotal, subtotal: itemsTotal - discount };
}

// ---------------------------------------------------------------------------------------------------------------
// Public code check

export const couponCheckSchema = z.object({
  code: z.string().max(40),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        variant: z.number().int().min(0).max(50),
        qty: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(30),
});

export type CouponCheckRequest = z.input<typeof couponCheckSchema>;

/** What the checkout form gets back for a code. `code` is the normalised spelling. */
export type CouponAnswer =
  | { ok: true; code: string; discount: number; itemsTotal: number; subtotal: number }
  | { ok: false; reason: CouponReason; message: string };

export type CouponCheckResult = CouponAnswer | { ok: false; reason: "rate_limited" | "failed"; message: string };

// ---------------------------------------------------------------------------------------------------------------
// Admin form: shared by the form and the server function.

const MAX_VALUE = 10_000_000;

const optionalAmount = (label: string) =>
  z
    .number(`${label} must be a number`)
    .int("Whole taka only")
    .min(1, `${label} must be at least 1`)
    .max(MAX_VALUE)
    .nullable();

export const couponInputSchema = z
  .object({
    name: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Name the coupon").max(80, "Keep the name under 80 characters")),
    code: z
      .string()
      .transform((value) => value.trim().toUpperCase())
      .pipe(z.string().regex(COUPON_CODE_PATTERN, "The code is 3 to 20 letters, digits or hyphens")),
    type: z.enum(DISCOUNT_TYPES),
    value: z.number("Enter the amount off").int("Whole numbers only").min(1, "Enter the amount off").max(MAX_VALUE),
    minOrder: z
      .number("Minimum order must be a number")
      .int("Whole taka only")
      .min(0, "Minimum order cannot be negative")
      .max(MAX_VALUE)
      .nullable(),
    maxDiscount: optionalAmount("The cap"),
    usageLimit: optionalAmount("The use limit"),
    startsAt: isoDate,
    endsAt: isoDate.nullable(),
    active: z.boolean(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "percent" && input.value > 99)
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage coupon takes 1 to 99 percent off" });
    if (input.endsAt !== null && input.endsAt <= input.startsAt)
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
  })
  // A cap only means something on a percent coupon.
  .transform((input) => ({ ...input, maxDiscount: input.type === "percent" ? input.maxDiscount : null }));

export type CouponInput = z.output<typeof couponInputSchema>;
export type CouponRequest = z.input<typeof couponInputSchema>;

export const saveCouponSchema = z.object({
  /** null creates a coupon. */
  id: z.number().int().positive().nullable(),
  /** The revision the form loaded; "" for a new coupon. */
  revision: z.string().max(64),
  input: couponInputSchema,
});

export type SaveCouponRequest = z.input<typeof saveCouponSchema>;

/** A coupon as the admin list and form see it. */
export interface AdminCoupon extends CouponInput {
  id: number;
  revision: string;
  createdAt: string;
  updatedAt: string;
  usedCount: number;
}

export type SaveCouponResult = { ok: true; coupon: AdminCoupon } | { ok: false; error: string; conflict?: boolean };

export type CouponState = "off" | "upcoming" | "live" | "ended" | "used_up";

export function couponState(
  coupon: Pick<AdminCoupon, "active" | "startsAt" | "endsAt" | "usageLimit" | "usedCount">,
  nowMs: number,
): CouponState {
  if (!coupon.active) return "off";
  if (coupon.endsAt !== null && Date.parse(coupon.endsAt) <= nowMs) return "ended";
  if (Date.parse(coupon.startsAt) > nowMs) return "upcoming";
  return coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit ? "used_up" : "live";
}

export const COUPON_STATE_LABELS: Record<CouponState, string> = {
  off: "Off",
  upcoming: "Upcoming",
  live: "Live",
  ended: "Ended",
  used_up: "Used up",
};

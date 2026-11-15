// Sale prices (P9.2). Pure: no React, no D1, no fetch. The public read path and checkout both price through
// bestSale(), so a card, the bag and the order always agree.
//
// Rules:
// - A sale is active when `active` is on and startsAt <= now < endsAt (endsAt null = no end date).
// - Every active sale that covers a product competes (a product sale, a category sale, a shop-wide sale). The one that
//   gives the lowest charged price wins; they never stack. On a tie the narrower scope wins, then the lower id.
// - A percent sale takes floor(price * value / 100) off, so the shopper never pays a fraction of a taka less than the
//   rounded figure. An amount sale takes `value` off. The charged price is never below 1.
// - A sale that would not lower the price (the price is already 1) does not apply.
import { z } from "zod";

export const DISCOUNT_SCOPES = ["all", "category", "product"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export const DISCOUNT_TYPES = ["percent", "amount"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const SCOPE_LABELS: Record<DiscountScope, string> = {
  all: "Every product",
  category: "One category",
  product: "One product",
};

/** The fields of a sale that decide a price. This is what the summary snapshot carries. */
export interface SaleRule {
  id: number;
  scope: DiscountScope;
  /** Set for `category` scope only. */
  categoryId: string | null;
  /** Set for `product` scope only. */
  productId: number | null;
  type: DiscountType;
  /** Percent (1 to 99) or whole taka. */
  value: number;
  /** ISO 8601 UTC. */
  startsAt: string;
  /** ISO 8601 UTC; null = no end date. */
  endsAt: string | null;
}

/** What a rule is matched against: a product's id and its category id. */
export interface SaleTarget {
  id: number;
  category: string;
}

/** The price a product is charged now, and what it is struck down from when a sale applies. */
export interface SalePrice {
  /** What the shopper pays per piece. */
  price: number;
  /** The price before any sale (the `products.price` column). */
  listPrice: number;
  /** The winning sale, or null when none applies. */
  saleId: number | null;
}

export function isSaleActive(rule: Pick<SaleRule, "startsAt" | "endsAt">, nowMs: number): boolean {
  const start = Date.parse(rule.startsAt);
  const end = rule.endsAt === null ? Infinity : Date.parse(rule.endsAt);
  // A date that does not parse is NaN, which fails both comparisons: such a rule never applies.
  return start <= nowMs && nowMs < end;
}

export function saleCovers(rule: SaleRule, product: SaleTarget): boolean {
  if (rule.scope === "all") return true;
  if (rule.scope === "category") return rule.categoryId === product.category;
  return rule.productId === product.id;
}

/** The charged price for one rule, ignoring dates and scope. Never below 1 and never above the list price. */
export function saleUnitPrice(listPrice: number, rule: Pick<SaleRule, "type" | "value">): number {
  const off = rule.type === "percent" ? Math.floor((listPrice * rule.value) / 100) : rule.value;
  return Math.min(listPrice, Math.max(1, listPrice - off));
}

const SCOPE_RANK: Record<DiscountScope, number> = { product: 0, category: 1, all: 2 };

/**
 * The sale to charge for one product, or null. `rules` may hold ended, upcoming and unrelated sales; they are
 * filtered here, so callers pass the whole short list.
 */
export function bestSale(
  rules: readonly SaleRule[],
  product: SaleTarget,
  listPrice: number,
  nowMs: number,
): { rule: SaleRule; price: number } | null {
  let best: { rule: SaleRule; price: number } | null = null;
  for (const rule of rules) {
    if (!isSaleActive(rule, nowMs) || !saleCovers(rule, product)) continue;
    const price = saleUnitPrice(listPrice, rule);
    if (price >= listPrice) continue;
    if (
      !best ||
      price < best.price ||
      (price === best.price &&
        (SCOPE_RANK[rule.scope] < SCOPE_RANK[best.rule.scope] ||
          (rule.scope === best.rule.scope && rule.id < best.rule.id)))
    )
      best = { rule, price };
  }
  return best;
}

export function priceFor(rules: readonly SaleRule[], product: SaleTarget, listPrice: number, nowMs: number): SalePrice {
  const best = bestSale(rules, product, listPrice, nowMs);
  return { price: best?.price ?? listPrice, listPrice, saleId: best?.rule.id ?? null };
}

/**
 * The struck-through price shown beside a sale price. A product that already carries a manual `regular_price` keeps
 * the higher of it and the pre-sale price, so a sale never shows a smaller "was" price than the shop already advertised.
 */
export const strikePrice = (listPrice: number, regularPrice: number | null): number =>
  Math.max(listPrice, regularPrice ?? 0);

/** Badge text for a card: "20% off" (rounded down), or "Sale" when the cut is under 1%. */
export function saleBadge(strike: number, price: number): string {
  const percent = strike > 0 ? Math.floor(((strike - price) * 100) / strike) : 0;
  return percent >= 1 ? `${percent}% off` : "Sale";
}

// ---------------------------------------------------------------------------------------------------------------
// Admin form: shared by the form and the server function.

/** Dhaka is UTC+6 all year (no daylight saving), the same offset `shopDay` uses. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** `2026-11-20T09:30` (Asia/Dhaka, from a datetime-local field) as ISO UTC, or null when it is not a date and time. */
export function dhakaLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const ms = Date.parse(`${local}:00.000Z`) - DHAKA_OFFSET_MS;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** ISO UTC as `YYYY-MM-DDTHH:mm` in Asia/Dhaka, for a datetime-local field. */
export const isoToDhakaLocal = (iso: string): string =>
  new Date(Date.parse(iso) + DHAKA_OFFSET_MS).toISOString().slice(0, 16);

const MAX_VALUE = 10_000_000;

/**
 * A date and time from an admin form, as ISO UTC. Capped in length, and the year must be 2000 to 9999: a later year
 * serialises with a sign ("+010000-...") and sorts before every normal date as SQL text.
 */
export const isoDate = z
  .string()
  .max(40, "Enter a date and time")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a date and time")
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return Number.isNaN(year) || (year >= 2000 && year <= 9999);
  }, "Use a year from 2000 to 9999")
  // One canonical text form, so SQL can compare dates as strings.
  .transform((value) => new Date(value).toISOString());

export const discountInputSchema = z
  .object({
    name: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Name the sale").max(80, "Keep the name under 80 characters")),
    scope: z.enum(DISCOUNT_SCOPES),
    categoryId: z.string().min(1).max(40).nullable(),
    productId: z.number().int().positive().max(2_147_483_647).nullable(),
    type: z.enum(DISCOUNT_TYPES),
    value: z.number("Enter the amount off").int("Whole numbers only").min(1, "Enter the amount off").max(MAX_VALUE),
    startsAt: isoDate,
    endsAt: isoDate.nullable(),
    active: z.boolean(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "percent" && input.value > 99)
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage sale takes 1 to 99 percent off" });
    if (input.scope === "category" && !input.categoryId)
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    if (input.scope === "product" && input.productId === null)
      ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose a product" });
    if (input.endsAt !== null && input.endsAt <= input.startsAt)
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
  })
  // Fields that do not belong to the scope are dropped, so a stale category never rides along with a product sale.
  .transform((input) => ({
    ...input,
    categoryId: input.scope === "category" ? input.categoryId : null,
    productId: input.scope === "product" ? input.productId : null,
  }));

export type DiscountInput = z.output<typeof discountInputSchema>;
export type DiscountRequest = z.input<typeof discountInputSchema>;

export const saveDiscountSchema = z.object({
  /** null creates a sale. */
  id: z.number().int().positive().nullable(),
  /** The revision the form loaded; "" for a new sale. */
  revision: z.string().max(64),
  input: discountInputSchema,
});

export type SaveDiscountRequest = z.input<typeof saveDiscountSchema>;

/** A sale as the admin list and form see it. */
export interface AdminDiscount extends DiscountInput {
  id: number;
  revision: string;
  createdAt: string;
  updatedAt: string;
  /** The product's or category's name, for the list. */
  targetName: string | null;
}

export type SaveDiscountResult =
  | { ok: true; discount: AdminDiscount; warning?: string }
  | { ok: false; error: string; conflict?: boolean };

export type SaleState = "off" | "upcoming" | "live" | "ended";

export function saleState(discount: Pick<AdminDiscount, "active" | "startsAt" | "endsAt">, nowMs: number): SaleState {
  if (!discount.active) return "off";
  if (discount.endsAt !== null && Date.parse(discount.endsAt) <= nowMs) return "ended";
  return Date.parse(discount.startsAt) > nowMs ? "upcoming" : "live";
}

export const SALE_STATE_LABELS: Record<SaleState, string> = {
  off: "Off",
  upcoming: "Upcoming",
  live: "Live",
  ended: "Ended",
};

/** "20% off" or "৳100 off". */
export const discountLabel = (discount: Pick<DiscountInput, "type" | "value">): string =>
  discount.type === "percent" ? `${discount.value}% off` : `৳${discount.value.toLocaleString("en-US")} off`;

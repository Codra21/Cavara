// Guest order rules shared by the checkout form, the server function and the admin. Pure: no React, no D1.
import { z } from "zod";
import { type CouponAnswer, normalizeCouponCode } from "@/domain/coupons";
import { MAX_QTY } from "@/lib/config";

export const ORDER_STATUSES = ["new", "confirmed", "dispatched", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuses that count as a sale on the dashboard (revenue and profit). */
export const SOLD_STATUSES: readonly OrderStatus[] = ["confirmed", "dispatched", "delivered"];
export const isSold = (status: OrderStatus) => SOLD_STATUSES.includes(status);

/** Most distinct lines one order may hold; each line is still capped at MAX_QTY. */
export const MAX_ORDER_LINES = 30;

/** Submissions allowed per 15 minutes, counted in D1 so every Worker isolate shares them. */
export const ORDER_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const ORDER_LIMITS = { ip: 10, phone: 5, couponIp: 20 } as const;

/** Orders a phone may have waiting at status 'new' (P10.5). A third is refused until staff confirm or cancel one. */
export const MAX_OPEN_ORDERS = 2;

export interface DeliveryZone {
  id: string;
  name: string;
  /** Base charge for the first kg, whole BDT. */
  charge: number;
  /** Extra charge per additional kg (whole BDT, defaults to 20). */
  perKgCharge?: number;
}

/** Blank product weight counts as 1 kg (1000 g). */
export const DEFAULT_PRODUCT_WEIGHT_G = 1000;
/** Default extra charge per kg above the first kg (whole BDT). */
export const DEFAULT_PER_KG_CHARGE = 20;

/** Total parcel weight in grams; items with a blank/null weight count as 1000 g each. */
export function calculateTotalWeightG(items: readonly { weightG?: number | null; qty: number }[]): number {
  return items.reduce((sum, item) => sum + (item.weightG ?? DEFAULT_PRODUCT_WEIGHT_G) * item.qty, 0);
}

/**
 * Weight-based delivery charge: zone base + per-kg step × (ceil(total kg) − 1).
 * Example: 1.2 kg inside Dhaka (৳80 base, ৳20/kg) = 80 + 20 × (2 − 1) = ৳100.
 */
export function calculateDeliveryCharge(
  zone: Pick<DeliveryZone, "charge" | "perKgCharge">,
  totalWeightG: number,
): number {
  const billedKg = Math.max(1, Math.ceil(totalWeightG / 1000));
  const perKg = zone.perKgCharge ?? DEFAULT_PER_KG_CHARGE;
  return zone.charge + perKg * (billedKg - 1);
}

/**
 * Bangladeshi mobile number in its 11-digit local form (01XXXXXXXXX), or null.
 * Accepts spaces, dashes, dots and brackets, and the +880 / 880 / 0088 country prefixes.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = `0${digits.slice(3)}`;
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** 01712345678 → 01712-345678, the way numbers are usually written in Bangladesh. */
export function formatPhone(phone: string): string {
  return /^01\d{9}$/.test(phone) ? `${phone.slice(0, 5)}-${phone.slice(5)}` : phone;
}

/** Collapses runs of whitespace (including newlines in single-line fields) and trims. */
const singleLine = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const checkoutItemSchema = z.object({
  productId: z.number().int().positive(),
  variant: z.number().int().min(0).max(50),
  qty: z.number().int().min(1).max(MAX_QTY),
  /** The unit price the shopper saw, so a price change is reported instead of silently charged. */
  unitPrice: z.number().int().positive(),
});

export const checkoutSchema = z
  .object({
    /** One per checkout attempt (crypto.randomUUID()); a retry with the same key returns the same order. */
    idempotencyKey: z.uuid(),
    name: singleLine(80).pipe(z.string().min(2, "Enter your name")),
    phone: z
      .string()
      .max(30)
      .transform((value, ctx) => {
        const phone = normalizePhone(value);
        if (!phone) {
          ctx.addIssue({ code: "custom", message: "Enter a Bangladeshi mobile number, e.g. 01712-345678" });
          return z.NEVER;
        }
        return phone;
      }),
    zoneId: z.string().min(1, "Choose a delivery area").max(40),
    address: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(8, "Enter your full delivery address").max(300, "Keep the address under 300 characters")),
    note: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(300, "Keep the note under 300 characters")),
    /** The delivery charge the shopper saw for the chosen zone. */
    deliveryCharge: z.number().int().min(0),
    items: z
      .array(checkoutItemSchema)
      .min(1, "Your cart is empty")
      .max(MAX_ORDER_LINES, `An order can hold up to ${MAX_ORDER_LINES} different pieces`),
    /** The coupon the shopper applied ("" for none), upper case. One per order. */
    couponCode: z
      .string()
      .max(40)
      .default("")
      .transform((value, ctx) => {
        if (value.trim() === "") return "";
        const code = normalizeCouponCode(value);
        if (!code) {
          ctx.addIssue({ code: "custom", message: "Enter a valid code" });
          return z.NEVER;
        }
        return code;
      }),
    /** The discount the shopper saw for that code, so a change is reported instead of silently charged. */
    couponDiscount: z.number().int().min(0).default(0),
    /** Honeypot: hidden from people, so anything here means a bot. */
    website: z.string().max(200).default(""),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const item of value.items) {
      const key = `${item.productId}:${item.variant}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items"], message: "Duplicate bag line" });
      seen.add(key);
    }
  });

export type CheckoutInput = z.output<typeof checkoutSchema>;
export type CheckoutRequest = z.input<typeof checkoutSchema>;

export type CheckoutField = "name" | "phone" | "zoneId" | "address" | "note" | "items" | "couponCode";

export type SubmitOrderResult =
  | { ok: true; reference: string; total: number; replayed: boolean }
  | { ok: false; code: "validation"; message: string; fieldErrors: Partial<Record<CheckoutField, string>> }
  | {
      ok: false;
      code: "rate_limited" | "open_orders" | "phone_blocked" | "unavailable" | "idempotency_conflict" | "failed";
      message: string;
    }
  | {
      ok: false;
      code: "price_changed";
      message: string;
      /** Current prices, so the form can show the new total. */
      prices: { productId: number; variant: number; unitPrice: number }[];
      deliveryCharge: number;
      /** The coupon as it stands now (a changed discount, or why it stopped applying); null when none was sent. */
      coupon: CouponAnswer | null;
    };

/** Asia/Dhaka calendar day (UTC+6 all year, no daylight saving) as YYYY-MM-DD. */
export function shopDay(date: Date): string {
  return new Date(date.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Letters and digits that are hard to confuse when read over the phone (no 0/O, 1/I/L). */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Short order reference for customers and staff, e.g. "CV-7KQ2MX". 31^6 ≈ 887 million combinations. */
export function newReference(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(6));
  return `CV-${Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join("")}`;
}

/** The fields that define an order, in a fixed order, for the idempotency comparison. */
export function canonicalCheckout(input: CheckoutInput): string {
  return JSON.stringify([
    input.name,
    input.phone,
    input.zoneId,
    input.address,
    input.note,
    input.deliveryCharge,
    input.items.map((item) => [item.productId, item.variant, item.qty, item.unitPrice]),
    // Only when a code is sent, so the hash of an order without one is the same as before coupons existed.
    ...(input.couponCode ? [input.couponCode, input.couponDiscount] : []),
  ]);
}

/** Field errors keyed by form field, first message per field. */
export function checkoutFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Partial<Record<CheckoutField, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "items") as CheckoutField;
    if (["name", "phone", "zoneId", "address", "note", "items", "couponCode"].includes(field))
      errors[field] ??= issue.message;
    else errors.items ??= issue.message;
  }
  return errors;
}

// Admin: order status changes (unit 7b)

/**
 * Allowed next fulfilment statuses. Orders move forward one step at a time, can be cancelled until delivered, and a
 * cancelled order can be reopened as new. Delivered is final, so the dashboard's sales stay stable.
 */
export const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["delivered", "cancelled"],
  delivered: [],
  cancelled: ["new"],
};

export function canChangeStatus(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "New",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PAYMENT_METHODS = ["bkash", "nagad", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  cash: "Cash",
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  refunded: "Refunded",
};

/** Verb for the button that moves an order to `status`. */
export const STATUS_ACTIONS: Record<OrderStatus, string> = {
  new: "Reopen",
  confirmed: "Confirm",
  dispatched: "Mark dispatched",
  delivered: "Mark delivered",
  cancelled: "Cancel order",
};

export const updateOrderSchema = z
  .object({
    id: z.uuid(),
    /** The version the admin loaded; a stale one is refused. */
    version: z.number().int().min(1),
    status: z.enum(ORDER_STATUSES),
    paymentStatus: z.enum(PAYMENT_STATUSES),
    amountPaid: z.number().int().min(0).max(10_000_000).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
    note: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(300, "Keep the note under 300 characters")),
  })
  .strict();

export type UpdateOrderInput = z.output<typeof updateOrderSchema>;

export type UpdateOrderResult =
  | { ok: true; version: number; warning?: string }
  | { ok: false; error: string; conflict?: boolean };

export const ORDER_PAGE_SIZE = 50;

export const orderListSchema = z.object({
  status: z.enum(["all", ...ORDER_STATUSES]).default("all"),
  /** A phone number or an order reference; anything else matches nothing. */
  search: z.string().trim().max(40).default(""),
  /** Keyset cursor: the last row of the previous page. */
  after: z
    .object({ createdAt: z.string().max(40), id: z.uuid() })
    .nullable()
    .default(null),
});

export type OrderListQuery = z.input<typeof orderListSchema>;

export interface AdminOrderSummary {
  id: string;
  reference: string;
  customerName: string;
  phone: string;
  zoneName: string;
  total: number;
  itemCount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  amountPaid?: number;
  paymentMethod?: PaymentMethod | null;
  createdAt: string;
}

export interface AdminOrderPage {
  orders: AdminOrderSummary[];
  /** Pass back as `after` for the next page; null on the last page. */
  next: { createdAt: string; id: string } | null;
}

export interface AdminOrderLine {
  line: number;
  productId: number;
  variantPosition: number;
  productName: string;
  variantName: string;
  availability: string;
  /** What was charged per piece. */
  unitPrice: number;
  /** The price before the sale, and the sale that took the difference. Null on orders placed before P9.2. */
  listPrice: number | null;
  discountId: number | null;
  costPrice: number | null;
  qty: number;
  lineTotal: number;
}

export interface AdminOrderEvent {
  id: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  fromPaymentStatus: PaymentStatus | null;
  toPaymentStatus: PaymentStatus;
  actorUsername: string | null;
  note: string;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  address: string;
  note: string;
  zoneId: string;
  deliveryCharge: number;
  totalWeightG?: number;
  /** The item total after the coupon (what revenue counts). */
  subtotal: number;
  /** The item total before the coupon; equals `subtotal` on orders without one and on orders placed before P9.3. */
  itemsTotal: number;
  couponCode: string | null;
  couponDiscount: number;
  version: number;
  shopDay: string;
  lines: AdminOrderLine[];
  history: AdminOrderEvent[];
}

/**
 * Sales effect of one order on its day's totals. Revenue is the item subtotal after the coupon. Profit is the margin
 * on lines that have a cost price, less the coupon discount (the coupon comes out of the shop's margin).
 */
export function orderSales(
  lines: Pick<AdminOrderLine, "unitPrice" | "costPrice" | "qty">[],
  subtotal: number,
  couponDiscount = 0,
) {
  return {
    revenue: subtotal,
    profit:
      lines.reduce(
        (sum, line) => sum + (line.costPrice === null ? 0 : (line.unitPrice - line.costPrice) * line.qty),
        0,
      ) - couponDiscount,
    linesWithoutCost: lines.filter((line) => line.costPrice === null).length,
  };
}

/**
 * What the admin search box means: a phone number, an order reference, or nothing searchable.
 * Both are exact, indexed lookups (D1 read budget: no LIKE scans).
 */
export function parseOrderSearch(raw: string): { phone: string } | { reference: string } | null {
  const value = raw.trim();
  if (!value) return null;
  const phone = normalizePhone(value);
  if (phone) return { phone };
  const reference = value.toUpperCase().replace(/^CV-?/, "");
  return /^[2-9A-HJKMNP-Z]{6}$/.test(reference) ? { reference: `CV-${reference}` } : null;
}

// Admin: delivery zones

export const zoneInputSchema = z.object({
  /** null for a new zone; its id is made from the name. */
  id: z.string().max(40).nullable(),
  name: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Name the delivery area").max(60)),
  charge: z.number().int("Whole taka only").min(0).max(100_000),
  perKgCharge: z.number().int("Whole taka only").min(0).max(100_000).default(DEFAULT_PER_KG_CHARGE),
  active: z.boolean(),
});

export const saveZonesSchema = z.object({
  zones: z
    .array(zoneInputSchema)
    .min(1)
    .max(20)
    .superRefine((zones, ctx) => {
      if (!zones.some((zone) => zone.active)) {
        ctx.addIssue({ code: "custom", message: "Keep at least one delivery area active, or checkout cannot work" });
      }
      const names = new Set<string>();
      const ids = new Set<string>();
      for (const zone of zones) {
        if (zone.id !== null) {
          if (ids.has(zone.id)) ctx.addIssue({ code: "custom", message: `Delivery area "${zone.id}" appears twice` });
          ids.add(zone.id);
        }
        const key = zone.name.toLowerCase();
        if (names.has(key)) ctx.addIssue({ code: "custom", message: `Two areas are named "${zone.name}"` });
        names.add(key);
      }
    }),
});

export type ZoneInput = z.output<typeof zoneInputSchema>;

export interface AdminZone extends DeliveryZone {
  active: boolean;
  sort: number;
}

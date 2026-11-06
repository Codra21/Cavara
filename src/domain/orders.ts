// Guest order rules shared by the checkout form, the server function and the admin. Pure: no React, no D1.
import { z } from "zod";
import { MAX_QTY } from "@/lib/config";

export const ORDER_STATUSES = ["new", "confirmed", "dispatched", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuses that count as a sale on the dashboard (revenue and profit). */
export const SOLD_STATUSES: readonly OrderStatus[] = ["confirmed", "dispatched", "delivered"];
export const isSold = (status: OrderStatus) => SOLD_STATUSES.includes(status);

/** Most distinct lines one order may hold; each line is still capped at MAX_QTY. */
export const MAX_ORDER_LINES = 30;

/** Submissions allowed per 15 minutes, counted in D1 so every Worker isolate shares them. */
export const ORDER_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const ORDER_LIMITS = { ip: 10, phone: 5 } as const;

export interface DeliveryZone {
  id: string;
  name: string;
  /** Whole BDT. */
  charge: number;
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
      .min(1, "Your bag is empty")
      .max(MAX_ORDER_LINES, `An order can hold up to ${MAX_ORDER_LINES} different pieces`),
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

export type CheckoutField = "name" | "phone" | "zoneId" | "address" | "note" | "items";

export type SubmitOrderResult =
  | { ok: true; reference: string; total: number; replayed: boolean }
  | { ok: false; code: "validation"; message: string; fieldErrors: Partial<Record<CheckoutField, string>> }
  | { ok: false; code: "rate_limited" | "unavailable" | "idempotency_conflict" | "failed"; message: string }
  | {
      ok: false;
      code: "price_changed";
      message: string;
      /** Current prices, so the form can show the new total. */
      prices: { productId: number; variant: number; unitPrice: number }[];
      deliveryCharge: number;
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
  ]);
}

/** Field errors keyed by form field, first message per field. */
export function checkoutFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Partial<Record<CheckoutField, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "items") as CheckoutField;
    if (["name", "phone", "zoneId", "address", "note", "items"].includes(field)) errors[field] ??= issue.message;
    else errors.items ??= issue.message;
  }
  return errors;
}

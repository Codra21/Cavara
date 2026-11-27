// Bag rules shared by the store, the drawer and checkout. Pure: no React, no D1, no fetch.
//
// The bag stores only `{ id, variant, qty }` (localStorage `cavara-bag-v1`). Names, prices and pictures come from
// getProductsByIdsFn, so a line can be in four states: still loading, buyable, a colour that is out of stock, or no
// longer sold. Checkout re-prices on the server (invariant 3); everything here is display.
import { formatPrice } from "@/domain/catalog";
import type { ProductCard } from "@/domain/catalog-snapshot";
import { MAX_ORDER_LINES } from "@/domain/orders";
import { MAX_QTY } from "@/lib/config";
import type { Availability, BagItem } from "@/lib/types";

/** An order holds at most this many lines (checkoutSchema), so a bag with more could never be placed. */
export const MAX_BAG_LINES = MAX_ORDER_LINES;

/** Same bounds as getProductsByIdsFn and checkoutItemSchema, so a stored id can always be looked up. */
const MAX_PRODUCT_ID = 2_147_483_647;
const MAX_VARIANT_INDEX = 50;

export const LOW_STOCK_THRESHOLD = 3;

export const maxQtyForStock = (stock: number | null | undefined): number =>
  typeof stock === "number" ? Math.min(MAX_QTY, Math.max(0, Math.floor(stock))) : MAX_QTY;

export const lowStockLabel = (stock: number | null | undefined): string | null =>
  typeof stock === "number" && stock > 0 && stock <= LOW_STOCK_THRESHOLD ? `Only ${stock} left` : null;

export const clampQty = (value: number, max = MAX_QTY) => Math.min(Math.max(1, max), Math.max(1, value));

/** Shown when adding a colour would make the bag's line count exceed MAX_BAG_LINES. */
export const BAG_FULL_MESSAGE = `Your cart is full (${MAX_BAG_LINES} different pieces). Remove one to add another.`;

/**
 * Adds `qty` of a colour. A colour already in the bag gains quantity (capped at MAX_QTY). A new colour becomes a new
 * line unless the bag already holds MAX_BAG_LINES, in which case nothing changes and `added` is false.
 */
export function addBagLine(
  bag: BagItem[],
  productId: number,
  variant: number,
  qty = 1,
  maxQty = MAX_QTY,
): { bag: BagItem[]; added: boolean } {
  const cap = Math.min(MAX_QTY, Math.max(0, Math.floor(maxQty)));
  if (cap <= 0) return { bag, added: true };
  const existing = bag.find((item) => item.id === productId && item.variant === variant);
  if (existing) {
    const nextQty = Math.min(cap, existing.qty + qty);
    return {
      // A line already above the cap (stock fell since it was added) comes down to it.
      bag: bag.map((item) => (item === existing ? { ...item, qty: nextQty } : item)),
      added: true,
    };
  }
  if (bag.length >= MAX_BAG_LINES) return { bag, added: false };
  return { bag: [...bag, { id: productId, variant, qty: clampQty(qty, cap) }], added: true };
}

/**
 * Turns whatever sits in localStorage into valid bag lines: integer ids and colour positions, quantity 1..20,
 * one line per product and colour (duplicates add up), at most MAX_BAG_LINES. Anything else is dropped. It does not
 * check that the product still exists, because that needs the server (see resolveBagLines).
 */
export function normalizeBag(raw: unknown): BagItem[] {
  if (!Array.isArray(raw)) return [];
  const lines = new Map<string, BagItem>();
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, variant, qty } = entry as { id?: unknown; variant?: unknown; qty?: unknown };
    const productId = Number(id);
    const colour = Number(variant);
    if (!Number.isInteger(productId) || productId < 1 || productId > MAX_PRODUCT_ID) continue;
    if (!Number.isInteger(colour) || colour < 0 || colour > MAX_VARIANT_INDEX) continue;
    const quantity = clampQty(Math.trunc(Number(qty)) || 1);
    const key = `${productId}:${colour}`;
    const existing = lines.get(key);
    if (existing) existing.qty = clampQty(existing.qty + quantity);
    else if (lines.size < MAX_BAG_LINES) lines.set(key, { id: productId, variant: colour, qty: quantity });
  }
  return [...lines.values()];
}

/** The part of getProductsByIdsFn's answer that line resolution needs. */
export interface BagLookup {
  products: ProductCard[];
  missing: number[];
}

type CardVariant = ProductCard["variants"][number];

export type BagLine =
  /** The lookup has not answered for this id yet. */
  | { status: "pending"; item: BagItem }
  /** The product is archived or unpublished, or the saved colour no longer exists. `product` is set in the second case. */
  | { status: "unavailable"; item: BagItem; product: ProductCard | null }
  /** The colour exists but is out of stock. The server refuses such an order. */
  | { status: "out_of_stock"; item: BagItem; product: ProductCard; variant: CardVariant }
  | { status: "ok"; item: BagItem; product: ProductCard; variant: CardVariant };

/**
 * One state per bag line, in bag order. With no lookup yet every line is pending. An id found in neither list is also
 * pending: a lookup for an older set of ids (kept on screen while a new one loads) says nothing about it.
 * Pre-order colours are buyable, like the server treats them.
 */
export function resolveBagLines(items: BagItem[], lookup: BagLookup | undefined): BagLine[] {
  if (!lookup) return items.map((item) => ({ status: "pending", item }));
  const products = new Map(lookup.products.map((product) => [product.id, product]));
  const missing = new Set(lookup.missing);
  return items.map((item): BagLine => {
    const product = products.get(item.id);
    if (!product)
      return missing.has(item.id) ? { status: "unavailable", item, product: null } : { status: "pending", item };
    const variant = product.variants[item.variant];
    if (!variant) return { status: "unavailable", item, product };
    if (variant.availability === "out_of_stock") return { status: "out_of_stock", item, product, variant };
    if (variant.availability === "preorder") return { status: "unavailable", item, product };
    // A saved quantity above the colour's stock is read as the stock, so the subtotal, the delivery weight and the
    // order all use what can actually be sold (the server still checks the real count).
    const cap = Math.max(1, maxQtyForStock(variant.stock));
    return { status: "ok", item: item.qty > cap ? { ...item, qty: cap } : item, product, variant };
  });
}

export type BuyableLine = Extract<BagLine, { status: "ok" }>;

export const isBuyable = (line: BagLine): line is BuyableLine => line.status === "ok";

/** Subtotal of the lines that can be bought. Unavailable and out-of-stock lines add nothing. */
export const bagSubtotal = (lines: BagLine[]) =>
  lines.reduce((sum, line) => (isBuyable(line) ? sum + line.product.price * line.item.qty : sum), 0);

/** Checkout needs a settled bag: at least one line and every line buyable. The server refuses anything else. */
export const canCheckout = (lines: BagLine[]) => lines.length > 0 && lines.every(isBuyable);

/** Lines that stop checkout for a reason the shopper can fix by removing them. */
export const blockedLines = (lines: BagLine[]) =>
  lines.filter((line) => line.status === "unavailable" || line.status === "out_of_stock");

/** Short tag for a line or card colour. null when nothing needs saying. */
export function availabilityTag(availability: Availability | undefined): string | null {
  if (availability === "out_of_stock") return "Sold out";
  if (availability === "preorder") return "Pre-order";
  return null;
}

/** The WhatsApp and Messenger text. Only buyable lines are listed, numbered from 1. */
export function bagOrderMessage(lines: BagLine[]): string {
  const buyable = lines.filter(isBuyable);
  const rows = buyable.map(
    (line, index) =>
      `${index + 1}. ${line.product.name} — Color: ${line.variant.name} — Qty: ${line.item.qty} — ${formatPrice(
        line.product.price * line.item.qty,
      )}`,
  );
  return [`Hi Cavara, I'd like to order:`, ...rows, `Subtotal: ${formatPrice(bagSubtotal(lines))}`].join("\n");
}

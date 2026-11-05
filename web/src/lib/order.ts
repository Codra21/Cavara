import { formatPrice, getVariant, productById } from "./catalog";
import { WHATSAPP_NUMBER } from "./config";
import type { BagItem, Product, Variant } from "./types";

export function whatsappUrl(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function singleOrderMessage(product: Product, variant: Variant, qty: number) {
  return `Hi Cavara, I want to order: ${product.name} - Color: ${variant.name} - Qty: ${qty} (${formatPrice(product.price * qty)})`;
}

export function bagSubtotal(items: BagItem[]) {
  return items.reduce((sum, item) => sum + (productById.get(item.id)?.price ?? 0) * item.qty, 0);
}

export function orderMessage(items: BagItem[]) {
  const lines = items.flatMap((item, index) => {
    const product = productById.get(item.id);
    if (!product) return [];
    const variant = getVariant(product, item.variant);
    return [`${index + 1}. ${product.name} — Color: ${variant.name} — Qty: ${item.qty} — ${formatPrice(product.price * item.qty)}`];
  });
  return [`Hi Cavara, I'd like to order:`, ...lines, `Subtotal: ${formatPrice(bagSubtotal(items))}`].join("\n");
}

export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a temporary selection below.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

import { formatPrice } from "@/domain/catalog";
import { WHATSAPP_NUMBER } from "./config";

export function whatsappUrl(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function singleOrderMessage(product: { name: string; price: number }, variant: { name: string }, qty: number) {
  return `Hi Cavara, I want to order: ${product.name} - Color: ${variant.name} - Qty: ${qty} (${formatPrice(product.price * qty)})`;
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

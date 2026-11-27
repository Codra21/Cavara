// Public order submission. csrfMiddleware in src/start.ts rejects cross-site calls; the handler validates everything
// itself (submitOrder), so the validator only passes the raw body through. The body also carries `turnstileToken`,
// checked with Siteverify first. Responses are private and never cached.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import type { SubmitOrderResult } from "@/domain/orders";
import { refreshProducts } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import {
  getAlertSettings,
  getDb,
  getOrderLimitSecret,
  getTurnstileSecret,
  isTurnstileEnforced,
  runAfterResponse,
} from "@/server/env";
import { deliverOrderAlerts } from "@/server/services/order-notifications.service";
import { submitOrder } from "@/server/services/orders.service";
import { splitTurnstileToken, TURNSTILE_REFUSAL_MESSAGE, verifyTurnstile } from "@/server/turnstile.server";

/** Largest body accepted: 30 lines plus the form fields fit in a few KB. */
const MAX_BODY_CHARS = 16_000;

export const submitOrderFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<SubmitOrderResult> => {
    setResponseHeader("Cache-Control", "private, no-store");
    try {
      if (JSON.stringify(data ?? null).length > MAX_BODY_CHARS) {
        return { ok: false, code: "validation", message: "That order is too large.", fieldErrors: {} };
      }
    } catch {
      return { ok: false, code: "validation", message: "That order could not be read.", fieldErrors: {} };
    }
    try {
      // Before any D1 access, so a bot without a valid token costs no database work and no rate-limit write.
      // The token travels beside the order body and is removed before the strict order schema sees it.
      const { token, rest } = splitTurnstileToken(data);
      const check = await verifyTurnstile(token, "order", {
        secret: getTurnstileSecret(),
        enforce: isTurnstileEnforced(),
        host: getRequestHeader("host") ?? "",
        remoteIp: getRequestHeader("cf-connecting-ip"),
      });
      if (!check.ok) return { ok: false, code: "failed", message: TURNSTILE_REFUSAL_MESSAGE };
      const db = getDb();
      const result = await submitOrder(db, rest, {
        client: getRequestHeader("cf-connecting-ip") || "local",
        limitSecret: getOrderLimitSecret(getRequestHeader("host") ?? ""),
      });
      if (result.ok && !result.replayed) {
        // The outbox row is already committed with the order. Send after the reply: Telegram's 8s timeout must not
        // hold checkout. runAfterResponse logs a failure, and the 5-minute cron claims any row still pending.
        const orderId = result.orderId;
        runAfterResponse("order alert", () => deliverOrderAlerts(db, getAlertSettings(), { orderId }));
      }
      if (!result.ok) return result;
      // A colour this order sold out shows "Out of stock" from the shop's copy of the catalogue. Patch it after the
      // reply, so the shopper does not wait for it; a failed patch is logged and the 5-minute copies catch up.
      if (result.soldOutProducts?.length) {
        const ids = result.soldOutProducts;
        runAfterResponse("sold-out catalogue refresh", () => refreshProducts(catalogSources(), ids));
      }
      // The order id and the product ids stay on the server.
      const { orderId: _orderId, soldOutProducts: _soldOut, ...reply } = result;
      return reply;
    } catch (error) {
      console.error("order submission failed", error);
      return {
        ok: false,
        code: "failed",
        message: "Your order could not be saved. Your cart is unchanged. Please try again, or message us on WhatsApp.",
      };
    }
  });

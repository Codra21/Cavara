// Public order submission. Start's default CSRF middleware rejects cross-site calls; the handler validates everything
// itself (submitOrder), so the validator only passes the raw body through. Responses are private and never cached.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import type { SubmitOrderResult } from "@/domain/orders";
import { getAlertSettings, getDb, getOrderLimitSecret } from "@/server/env";
import { deliverOrderAlerts } from "@/server/services/order-notifications.service";
import { submitOrder } from "@/server/services/orders.service";

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
      const db = getDb();
      const result = await submitOrder(db, data, {
        client: getRequestHeader("cf-connecting-ip") || "local",
        limitSecret: getOrderLimitSecret(),
      });
      if (result.ok && !result.replayed) {
        // Send the Telegram alert before replying (usually well under a second; 8 s timeout). The order is already
        // saved, so a failure only leaves the outbox row for the 5-minute cron; the shopper never sees an alert error.
        await deliverOrderAlerts(db, getAlertSettings(), { orderId: result.orderId }).catch((error: unknown) => {
          console.error("order alert failed", error);
        });
      }
      if (!result.ok) return result;
      // The order id stays on the server.
      const { orderId: _orderId, ...reply } = result;
      return reply;
    } catch (error) {
      console.error("order submission failed", error);
      return {
        ok: false,
        code: "failed",
        message: "Your order could not be saved. Your bag is unchanged. Please try again, or message us on WhatsApp.",
      };
    }
  });

// Public coupon check. POST with a body (the bag lines), never cached: the answer depends on the clock, the use count
// and the code, and an edge copy of it would let a used-up code keep working. csrfMiddleware in src/start.ts rejects
// cross-site calls; checkCoupon validates the body itself, so the validator only passes it through. The body also carries
// `turnstileToken`, checked with Siteverify first.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import type { CouponCheckResult } from "@/domain/coupons";
import { getDb, getOrderLimitSecret, getTurnstileSecret, isTurnstileEnforced } from "@/server/env";
import { checkCoupon } from "@/server/services/coupons.service";
import { splitTurnstileToken, TURNSTILE_REFUSAL_MESSAGE, verifyTurnstile } from "@/server/turnstile.server";

/** Largest body accepted: 30 lines, a coupon code and a Turnstile token fit in a few KB. */
const MAX_BODY_CHARS = 16_000;

export const checkCouponFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<CouponCheckResult> => {
    setResponseHeader("Cache-Control", "private, no-store");
    try {
      if (JSON.stringify(data ?? null).length > MAX_BODY_CHARS) {
        return { ok: false, reason: "failed", message: "That request is too large." };
      }
    } catch {
      return { ok: false, reason: "failed", message: "That request could not be read." };
    }
    try {
      // Before the rate-limit write, so a bot without a valid token cannot spend D1 writes or the shopper's allowance.
      const { token, rest } = splitTurnstileToken(data);
      const check = await verifyTurnstile(token, "coupon", {
        secret: getTurnstileSecret(),
        enforce: isTurnstileEnforced(),
        host: getRequestHeader("host") ?? "",
        remoteIp: getRequestHeader("cf-connecting-ip"),
      });
      if (!check.ok) return { ok: false, reason: "failed", message: TURNSTILE_REFUSAL_MESSAGE };
      return await checkCoupon(getDb(), rest, {
        client: getRequestHeader("cf-connecting-ip") || "local",
        limitSecret: getOrderLimitSecret(getRequestHeader("host") ?? ""),
      });
    } catch (error) {
      console.error("coupon check failed", error);
      return { ok: false, reason: "failed", message: "That code could not be checked. Try again." };
    }
  });

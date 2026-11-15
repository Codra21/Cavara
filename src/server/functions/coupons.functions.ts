// Public coupon check. POST with a body (the bag lines), never cached: the answer depends on the clock, the use count
// and the code, and an edge copy of it would let a used-up code keep working. Start's default CSRF middleware rejects
// cross-site calls; checkCoupon validates the body itself, so the validator only passes it through.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import type { CouponCheckResult } from "@/domain/coupons";
import { getDb, getOrderLimitSecret } from "@/server/env";
import { checkCoupon } from "@/server/services/coupons.service";

export const checkCouponFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<CouponCheckResult> => {
    setResponseHeader("Cache-Control", "private, no-store");
    try {
      return await checkCoupon(getDb(), data, {
        client: getRequestHeader("cf-connecting-ip") || "local",
        limitSecret: getOrderLimitSecret(),
      });
    } catch (error) {
      console.error("coupon check failed", error);
      return { ok: false, reason: "failed", message: "That code could not be checked. Try again." };
    }
  });

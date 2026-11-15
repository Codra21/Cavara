// Owner-only sales and coupons admin (P9.2, P9.3). The middleware marks every response private, no-store.
import { createServerFn } from "@tanstack/react-start";
import { saveCouponSchema } from "@/domain/coupons";
import { saveDiscountSchema } from "@/domain/discounts";
import { refreshSales } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import { listCoupons, saveCoupon } from "@/server/db/admin-coupons.repository";
import { listDiscounts, saveDiscount } from "@/server/db/admin-discounts.repository";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const listDiscountsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listDiscounts(getDb()));

export const saveDiscountFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(saveDiscountSchema)
  .handler(async ({ data, context }) => {
    const result = await saveDiscount(getDb(), context.admin, data);
    if (!result.ok) return result;
    // The shop's cards read sales from the summary snapshot: patch its sales list (reads only the discount rows).
    const refreshed = await refreshSales(catalogSources());
    return refreshed
      ? result
      : {
          ...result,
          warning: "Saved, but the shop's copy could not be updated. Prices will follow within a few minutes.",
        };
  });

export const listCouponsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listCoupons(getDb()));

// Checkout reads coupons from D1 by code, so a save has no snapshot to patch.
export const saveCouponFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(saveCouponSchema)
  .handler(({ data, context }) => saveCoupon(getDb(), context.admin, data));

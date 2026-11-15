// Owner-only stock counts and movements. Separate from the product save on purpose: a stock change never touches the
// product's revision, so an open editor can still save, and a save never writes a count.
import { createServerFn } from "@tanstack/react-start";
import { adjustStockSchema, stockMovementsSchema, stopCountingSchema } from "@/domain/stock";
import { refreshProduct } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import { adjustStock, listStockMovements, stopCounting } from "@/server/db/stock.repository";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const listStockMovementsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .validator(stockMovementsSchema)
  .handler(({ data }) => listStockMovements(getDb(), data.productId, data.after));

/** First count, stock in or stock out for one colour. Patches the shop's copy when the colour's availability changed. */
export const adjustStockFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(adjustStockSchema)
  .handler(async ({ data, context }) => {
    const { availabilityChanged, ...result } = await adjustStock(getDb(), context.admin, data);
    if (!result.ok || !availabilityChanged) return result;
    const refreshed = await refreshProduct(catalogSources(), data.productId);
    return refreshed
      ? result
      : {
          ...result,
          warning:
            "Saved, but the shop's copy of the stock could not be updated. It will catch up within a few minutes.",
        };
  });

/** Stops counting one colour. Availability is unchanged, so the shop's copy needs no patch. */
export const stopCountingFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(stopCountingSchema)
  .handler(({ data, context }) => stopCounting(getDb(), context.admin, data));

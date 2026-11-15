// Admin order inbox and delivery zones. Orders use adminAuthMiddleware (any signed-in admin; Staff join once their
// accounts exist). Zones are Owner-only. The middleware marks every response private, no-store.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orderListSchema, saveZonesSchema, updateOrderSchema } from "@/domain/orders";
import { getOrder, listOrders, listZones, saveZones, updateOrderStatus } from "@/server/db/admin-orders.repository";
import { refreshProducts, refreshZones } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import { getDb } from "@/server/env";
import { adminAuthMiddleware, ownerAuthMiddleware } from "@/server/middleware/auth";

export const listOrdersFn = createServerFn({ method: "GET" })
  .middleware([adminAuthMiddleware])
  .validator(orderListSchema)
  .handler(({ data }) => listOrders(getDb(), data));

export const getOrderFn = createServerFn({ method: "GET" })
  .middleware([adminAuthMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    const order = await getOrder(getDb(), data.id);
    // Cost prices and the sale taken off a line are Owner-only; Staff see the order without them.
    if (order && context.admin.role !== "owner") {
      return {
        ...order,
        lines: order.lines.map((line) => ({ ...line, costPrice: null, listPrice: null, discountId: null })),
      };
    }
    return order;
  });

export const updateOrderFn = createServerFn({ method: "POST" })
  .middleware([adminAuthMiddleware])
  .validator(updateOrderSchema)
  .handler(async ({ data, context }) => {
    const { crossedProducts, ...result } = await updateOrderStatus(getDb(), context.admin, data);
    // Cancelling or reopening can take a colour across 0; the shop's copy then needs that product patched.
    if (result.ok && crossedProducts?.length) {
      const refreshed = await refreshProducts(catalogSources(), crossedProducts);
      if (!refreshed) {
        return {
          ...result,
          warning:
            "Saved, but the shop's copy of the stock could not be updated. It will catch up within a few minutes.",
        };
      }
    }
    return result;
  });

export const listZonesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listZones(getDb()));

export const saveZonesFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(saveZonesSchema)
  .handler(async ({ data, context }) => {
    const result = await saveZones(getDb(), context.admin, data.zones);
    if (!result.ok) return result;
    // Checkout reads zones from the cached catalogue: patch the zones in the snapshots (reads only the zones).
    const refreshed = await refreshZones(catalogSources());
    return refreshed
      ? result
      : {
          ...result,
          warning:
            "Saved, but the shop's copy could not be updated. Checkout will show the new charges within a few minutes.",
        };
  });

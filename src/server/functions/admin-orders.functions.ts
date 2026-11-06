// Admin order inbox and delivery zones. Orders use adminAuthMiddleware (any signed-in admin; Staff join once their
// accounts exist). Zones are Owner-only. The middleware marks every response private, no-store.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orderListSchema, saveZonesSchema, updateOrderSchema } from "@/domain/orders";
import { getOrder, listOrders, listZones, saveZones, updateOrderStatus } from "@/server/db/admin-orders.repository";
import { refreshCatalog } from "@/server/catalog-cache.server";
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
    // Cost prices are Owner-only; Staff see the order without them.
    if (order && context.admin.role !== "owner") {
      return { ...order, lines: order.lines.map((line) => ({ ...line, costPrice: null })) };
    }
    return order;
  });

export const updateOrderFn = createServerFn({ method: "POST" })
  .middleware([adminAuthMiddleware])
  .validator(updateOrderSchema)
  .handler(({ data, context }) => updateOrderStatus(getDb(), context.admin, data));

export const listZonesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listZones(getDb()));

export const saveZonesFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(saveZonesSchema)
  .handler(async ({ data, context }) => {
    const result = await saveZones(getDb(), context.admin, data.zones);
    if (!result.ok) return result;
    // Checkout reads zones from the cached catalogue, so rebuild it now.
    const refreshed = await refreshCatalog(catalogSources());
    return refreshed
      ? result
      : {
          ...result,
          warning:
            "Saved, but the shop's copy could not be updated. Checkout will show the new charges within a few minutes.",
        };
  });

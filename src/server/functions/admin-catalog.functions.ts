// Owner-only catalogue server functions. ownerAuthMiddleware checks the session and marks responses private.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { bulkProductActionSchema, duplicateProductSchema } from "@/domain/admin-product-actions";
import { adminProductCountsSchema, adminProductListSchema } from "@/domain/admin-product-list";
import { saveProductSchema } from "@/domain/product-admin";
import { bulkUpdateProducts, duplicateProduct } from "@/server/db/admin-product-actions.repository";
import { countAdminProducts, listAdminProducts, listProductNames } from "@/server/db/admin-product-list.repository";
import { getAdminProduct, listAdminCategories, saveProduct } from "@/server/db/admin-catalog.repository";
import { refreshProduct, refreshProducts } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import { getDb, getImageBase } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

const SHOP_COPY_WARNING =
  "Saved, but the shop's copy of the catalogue could not be updated. Visitors will see the change once the shop reloads it from the database, within a few minutes.";

/** One page of the product list: filters, sort and cursor come from the page URL. */
export const listAdminProductsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .validator(adminProductListSchema)
  .handler(({ data }) => listAdminProducts(getDb(), data, getImageBase()));

/** Counts per status, for one category or all. The page caches it; it costs about one index entry per product. */
export const countAdminProductsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .validator(adminProductCountsSchema)
  .handler(({ data }) => countAdminProducts(getDb(), data.category));

/** Id, name, slug and status of every product, for the search box. Fetched once per session. */
export const listProductNamesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listProductNames(getDb()));

export const listAdminCategoriesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listAdminCategories(getDb()));

export const getAdminProductFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) => getAdminProduct(getDb(), data.id));

export const saveProductFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(saveProductSchema)
  .handler(async ({ data, context }) => {
    const result = await saveProduct(getDb(), {
      actor: context.admin,
      id: data.id,
      revision: data.revision,
      input: data.product,
    });
    if (!result.ok) return result;
    // Patches this product's entries in the snapshots (reads only its rows); a full rebuild is the fallback.
    const refreshed = await refreshProduct(catalogSources(), result.id);
    return refreshed ? result : { ...result, warning: SHOP_COPY_WARNING };
  });

/** Publish, unpublish, archive, change category or set/clear featured on up to 50 selected products. */
export const bulkProductActionFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(bulkProductActionSchema)
  .handler(async ({ data, context }) => {
    const result = await bulkUpdateProducts(getDb(), { actor: context.admin, action: data });
    if (!result.ok || result.shopIds.length === 0) return result;
    // One patch for every product the shop shows, however many were selected.
    const refreshed = await refreshProducts(catalogSources(), result.shopIds);
    return refreshed ? result : { ...result, warning: SHOP_COPY_WARNING };
  });

/** Copies a product into a new draft. The draft is not in the shop, so no snapshot changes. */
export const duplicateProductFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(duplicateProductSchema)
  .handler(({ data, context }) => duplicateProduct(getDb(), { actor: context.admin, ...data }));

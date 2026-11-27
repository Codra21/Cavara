// Owner-only category manager server functions.
import { createServerFn } from "@tanstack/react-start";
import { categoryInputSchema, type SaveCategoryResult } from "@/domain/categories-admin";
import { rebuildCatalog } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";
import { listManagedCategories, saveCategory } from "@/server/db/admin-categories.repository";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const listManagedCategoriesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listManagedCategories(getDb()));

export const saveCategoryFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(categoryInputSchema)
  .handler(async ({ context, data }): Promise<SaveCategoryResult> => {
    const result = await saveCategory(getDb(), context.admin, data);
    if (!result.ok) return result;
    const rebuilt = await rebuildCatalog(catalogSources());
    return rebuilt
      ? result
      : { ...result, warning: "Saved, but the shop snapshot could not refresh immediately. It will rebuild on the next visit." };
  });

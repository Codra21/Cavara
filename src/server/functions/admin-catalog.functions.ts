// Owner-only catalogue server functions. ownerAuthMiddleware checks the session and marks responses private.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { saveProductSchema } from "@/domain/product-admin";
import {
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  saveProduct,
} from "@/server/db/admin-catalog.repository";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const listAdminProductsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listAdminProducts(getDb()));

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
  .handler(({ data, context }) =>
    saveProduct(getDb(), { actor: context.admin, id: data.id, revision: data.revision, input: data.product }),
  );

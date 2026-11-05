// Function middleware for protected server functions. Adds the signed-in admin to `context.admin`.
import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { AdminAccessError, requireAdmin } from "@/server/admin/session.server";

function accessMiddleware(ownerOnly: boolean) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    try {
      const admin = await requireAdmin(ownerOnly);
      return await next({ context: { admin } });
    } catch (error) {
      if (error instanceof AdminAccessError) {
        setResponseStatus(error.status);
        throw new Error(error.message);
      }
      throw error;
    }
  });
}

/** Owner only: catalogue, delivery zones, dashboard, activity log. */
export const ownerAuthMiddleware = accessMiddleware(true);
/** Any signed-in admin: orders (Staff will join once their accounts exist). */
export const adminAuthMiddleware = accessMiddleware(false);

// Owner-only dashboard (revenue and profit include cost prices). ownerAuthMiddleware marks the response private.
import { createServerFn } from "@tanstack/react-start";
import { getDashboard } from "@/server/db/dashboard.repository";
import { getAlertSettings, getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const getDashboardFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => getDashboard(getDb(), new Date(), getAlertSettings() !== null));

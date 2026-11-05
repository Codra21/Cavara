// Admin session server functions. Responses are private and never cached (setPrivateNoStore).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { currentSession, signInWithCookie, signOutWithCookie } from "@/server/admin/session.server";
import { listAudit } from "@/server/admin/auth.server";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const getAdminSessionFn = createServerFn({ method: "GET" }).handler(() => currentSession());

export const signInFn = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(4096) }))
  .handler(({ data }) => signInWithCookie(data.username, data.password));

export const signOutFn = createServerFn({ method: "POST" }).handler(() => signOutWithCookie());

export const listAuditFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listAudit(getDb()));

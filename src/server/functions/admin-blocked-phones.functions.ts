// Owner-only blocked phone numbers (P10.5). The middleware marks every response private, no-store.
import { createServerFn } from "@tanstack/react-start";
import { blockPhoneSchema, phoneBlockedSchema, unblockPhoneSchema } from "@/domain/blocked-phones";
import {
  blockPhone,
  isPhoneBlocked,
  listBlockedPhones,
  unblockPhone,
} from "@/server/db/admin-blocked-phones.repository";
import { getDb } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const listBlockedPhonesFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(() => listBlockedPhones(getDb()));

export const isPhoneBlockedFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .validator(phoneBlockedSchema)
  .handler(async ({ data }) => ({ blocked: await isPhoneBlocked(getDb(), data.phone) }));

export const blockPhoneFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(blockPhoneSchema)
  .handler(async ({ data, context }) => ({
    ok: true as const,
    changed: await blockPhone(getDb(), context.admin, data),
  }));

export const unblockPhoneFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(unblockPhoneSchema)
  .handler(async ({ data, context }) => ({
    ok: true as const,
    changed: await unblockPhone(getDb(), context.admin, data.phone),
  }));

// Request-time access to Worker bindings. Import only from server-only modules (*.server.ts, server function handlers).
import { env } from "cloudflare:workers";
import { ownerCredentials } from "./admin/auth.server";
import type { D1Database, R2Bucket } from "./db/d1";
import { alertSettings, type AlertSettings } from "./services/order-notifications.service";

export function getImages(): R2Bucket {
  if (!env.IMAGES) throw new Error("R2 binding IMAGES is not configured for this Worker");
  return env.IMAGES;
}

/** Image origin without a trailing slash, or "" to serve images from this Worker's /media route. */
export function getImageBase(): string {
  return (env.IMAGE_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

/** R2 key of the catalogue snapshot, or "" when snapshots are off. */
export function getSnapshotKey(): string {
  return (env.CATALOG_SNAPSHOT_KEY ?? "").trim();
}

export function getDb(): D1Database {
  // A missing binding is a deployment error; fail loudly rather than render an empty catalogue.
  if (!env.DB) throw new Error("D1 binding DB is not configured for this Worker");
  return env.DB;
}

/**
 * Key for the HMACs that name order rate-limit rows. The rows expire after 15 minutes and only need to hide the raw
 * phone and IP, so a missing secret falls back to a fixed key (logged) rather than blocking every order.
 */
export function getOrderLimitSecret(): string {
  const secret = env.ORDER_RATE_LIMIT_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  console.warn("ORDER_RATE_LIMIT_SECRET is not set (or shorter than 32 characters); using the fallback key");
  return "cavara-order-limits-fallback-v1";
}

/** Telegram order-alert settings, or null when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. */
export function getAlertSettings(): AlertSettings | null {
  return alertSettings(env);
}

/** Owner credentials, or null when ADMIN_SECRET is not set (admin disabled). */
export function getOwnerCredentials() {
  return ownerCredentials(env);
}

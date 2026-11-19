// Request-time access to Worker bindings. Import only from server-only modules (*.server.ts, server function handlers).
import { createHmac } from "node:crypto";
import { env, waitUntil } from "cloudflare:workers";
import { ownerCredentials } from "./admin/auth.server";
import type { D1Database, R2Bucket } from "./db/d1";
import { alertSettings, type AlertSettings } from "./services/order-notifications.service";
import { isLocalHost } from "./turnstile.server";

/** Public HMAC key used only when no real secret is configured. Fine on localhost, guessable anywhere else. */
const ORDER_LIMIT_FALLBACK = "cavara-order-limits-fallback-v1";

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
 * Key for the HMACs that name order rate-limit rows. Uses ORDER_RATE_LIMIT_SECRET when it is at least 32 characters.
 * Otherwise derives a key from ADMIN_SECRET (logged) so a missing order secret does not make phone HMACs reversible
 * and does not stop checkout. The public fallback literal is only for local dev, where neither secret is set.
 * Off localhost, with neither secret, that same literal is still returned: throwing would break checkout.
 */
export function orderLimitSecret(
  source: { ORDER_RATE_LIMIT_SECRET?: string; ADMIN_SECRET?: string },
  host = "",
): string {
  const secret = source.ORDER_RATE_LIMIT_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;

  const admin = source.ADMIN_SECRET?.trim();
  if (admin) {
    console.warn(
      "ORDER_RATE_LIMIT_SECRET is not set or is shorter than 32 characters; deriving the order-limit key from ADMIN_SECRET",
    );
    return createHmac("sha256", admin).update("cavara-order-limits-v1").digest("hex");
  }

  console.warn("ORDER_RATE_LIMIT_SECRET is not set or is shorter than 32 characters; using the fallback key");
  if (!isLocalHost(host)) {
    console.warn("ADMIN_SECRET is not set either; checkout is using the public order-limit fallback");
  }
  return ORDER_LIMIT_FALLBACK;
}

export function getOrderLimitSecret(host = ""): string {
  return orderLimitSecret(env, host);
}

/** Turnstile secret key, or undefined when unset (see verifyTurnstile for what that means per host). */
export function getTurnstileSecret(): string | undefined {
  return env.TURNSTILE_SECRET_KEY?.trim() || undefined;
}

/**
 * False when the TURNSTILE_MODE var is "off": order submission and the coupon check then skip Siteverify. A switch for
 * the time a widget key is missing or wrong, so checkout keeps working; the phone and IP limits still apply.
 */
export function isTurnstileEnforced(): boolean {
  return env.TURNSTILE_MODE?.trim().toLowerCase() !== "off";
}

/** Telegram order-alert settings, or null when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. */
export function getAlertSettings(): AlertSettings | null {
  return alertSettings(env);
}

/** Owner credentials, or null when ADMIN_SECRET is not set (admin disabled). */
export function getOwnerCredentials() {
  return ownerCredentials(env);
}

/** Runs work after the response is sent (Workers `waitUntil`). A failure is logged and never reaches the caller. */
export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
  waitUntil(
    work().catch((error: unknown) => {
      console.error(`${label} failed`, error);
    }),
  );
}

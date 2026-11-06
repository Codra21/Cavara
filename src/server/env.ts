// Request-time access to Worker bindings. Import only from server-only modules (*.server.ts, server function handlers).
import { env } from "cloudflare:workers";
import { ownerCredentials } from "./admin/auth.server";
import type { D1Database, R2Bucket } from "./db/d1";

export function getImages(): R2Bucket {
  if (!env.IMAGES) throw new Error("R2 binding IMAGES is not configured for this Worker");
  return env.IMAGES;
}

/** Image origin without a trailing slash, or "" to serve images from this Worker's /media route. */
export function getImageBase(): string {
  return (env.IMAGE_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function getDb(): D1Database {
  // A missing binding is a deployment error; fail loudly rather than render an empty catalogue.
  if (!env.DB) throw new Error("D1 binding DB is not configured for this Worker");
  return env.DB;
}

/** Owner credentials, or null when ADMIN_SECRET is not set (admin disabled). */
export function getOwnerCredentials() {
  return ownerCredentials(env);
}

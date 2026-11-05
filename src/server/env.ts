// Request-time access to Worker bindings. Import only from server-only modules (*.server.ts, server function handlers).
import { env } from "cloudflare:workers";
import { ownerCredentials } from "./admin/auth.server";
import type { D1Database } from "./db/d1";

export function getDb(): D1Database {
  // A missing binding is a deployment error; fail loudly rather than render an empty catalogue.
  if (!env.DB) throw new Error("D1 binding DB is not configured for this Worker");
  return env.DB;
}

/** Owner credentials, or null when ADMIN_SECRET is not set (admin disabled). */
export function getOwnerCredentials() {
  return ownerCredentials(env);
}

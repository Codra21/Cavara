// Request-time access to Worker bindings. Import only from server-only modules (*.server.ts, server function handlers).
import { env } from "cloudflare:workers";
import type { D1Database } from "./db/d1";

export function getDb(): D1Database {
  // A missing binding is a deployment error; fail loudly rather than render an empty catalogue.
  if (!env.DB) throw new Error("D1 binding DB is not configured for this Worker");
  return env.DB;
}

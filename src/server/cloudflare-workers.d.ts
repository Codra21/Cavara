// Ambient type for the Workers `env` import (developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).
// Only server code may import "cloudflare:workers".
declare module "cloudflare:workers" {
  export const env: import("./db/d1").CloudflareEnv;
  // Copied from worker-configuration.d.ts (CloudflareWorkersModule): keeps the Worker alive until the promise settles.
  export function waitUntil(promise: Promise<unknown>): void;
}

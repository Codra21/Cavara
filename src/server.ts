// Worker entry: Start's own fetch handler plus scheduled() for cron triggers (wrangler.jsonc "main").
// Pattern from developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/ (Custom entrypoints) and
// tanstack.com/start/latest/docs/framework/react/guide/server-entry-point. Test the cron locally with
// curl "http://localhost:3000/cdn-cgi/local/scheduled?cron=10+*+*+*+*".
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import type { CloudflareEnv, ExecutionContext, ScheduledController } from "@/server/db/d1";
import { runUsageAlert } from "@/server/usage-alert.server";

const entry = createServerEntry({
  fetch(request, opts) {
    return handler.fetch(request, opts);
  },
});

export default {
  fetch: entry.fetch,
  scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Unit 8's order outbox will run from here too; route on controller.cron when it has its own schedule.
    ctx.waitUntil(
      runUsageAlert(env).catch((error: unknown) => {
        console.error("usage alert failed", error);
      }),
    );
  },
};

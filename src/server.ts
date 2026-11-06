// Worker entry: Start's own fetch handler plus scheduled() for cron triggers (wrangler.jsonc "main").
// Pattern from developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/ (Custom entrypoints) and
// tanstack.com/start/latest/docs/framework/react/guide/server-entry-point. Test the cron locally with
// curl "http://localhost:3000/cdn-cgi/local/scheduled?cron=10+*+*+*+*".
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import type { CloudflareEnv, ExecutionContext, ScheduledController } from "@/server/db/d1";
import { alertSettings, deliverOrderAlerts } from "@/server/services/order-notifications.service";
import { runUsageAlert } from "@/server/usage-alert.server";

/** Must match the crons in wrangler.jsonc env.production. */
const ORDER_ALERT_CRON = "*/5 * * * *";

const entry = createServerEntry({
  fetch(request, opts) {
    return handler.fetch(request, opts);
  },
});

export default {
  fetch: entry.fetch,
  scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    if (controller.cron === ORDER_ALERT_CRON) {
      // Retries order alerts that could not be sent right after the order (src/server/services/order-notifications).
      ctx.waitUntil(
        deliverOrderAlerts(env.DB, alertSettings(env))
          .then((report) => {
            if (report.sent.length || report.retrying.length || report.failed.length) {
              console.log("order alerts:", JSON.stringify(report));
            }
          })
          .catch((error: unknown) => {
            console.error("order alert run failed", error);
          }),
      );
      return;
    }
    ctx.waitUntil(
      runUsageAlert(env).catch((error: unknown) => {
        console.error("usage alert failed", error);
      }),
    );
  },
};

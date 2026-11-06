// Hourly cron: reads today's account-wide D1 rows read and Worker requests from the GraphQL Analytics API and sends
// a Telegram message when a total crosses an alert level (src/domain/usage.ts). Needs no D1, so it still works
// while D1 is blocked. Server-only.
//
// Fields: d1AnalyticsAdaptiveGroups.sum.rowsRead with datetimeHour_* filters (the query `wrangler d1 insights`
// sends, wrangler 4.158.0) and workersInvocationsAdaptive.sum.requests with datetime_* filters
// (developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/). Token: Account Analytics
// Read. Telegram: https://core.telegram.org/bots/api (sendMessage).
import { alertMessage, crossedLevel, DAILY_LIMITS, usageWindows, type UsageMetric } from "@/domain/usage";
import type { CloudflareEnv } from "@/server/db/d1";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

type UsageEnv = Pick<
  CloudflareEnv,
  "USAGE_ACCOUNT_ID" | "CF_ANALYTICS_TOKEN" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_USAGE_CHAT_ID"
>;

type Totals = Record<UsageMetric, { now: number; before: number }>;

interface GraphqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<Record<string, Array<{ sum?: { rowsRead?: number; requests?: number } }> | undefined>>;
    };
  };
  errors?: Array<{ message: string }>;
}

const iso = (date: Date) => date.toISOString();
// workersInvocationsAdaptive filters on exact timestamps; stop one second before the hour so it is excluded.
const endOfHour = (hourStart: Date) => iso(new Date(hourStart.getTime() + 3_600_000 - 1000));

/** The GraphQL query. Every interpolated value is an ISO timestamp computed here, never user input. */
export function usageQuery(dayStart: Date, through: Date, before: Date | null): string {
  const d1 = (alias: string, last: Date) =>
    `${alias}: d1AnalyticsAdaptiveGroups(limit: 1, filter: { datetimeHour_geq: "${iso(dayStart)}", datetimeHour_leq: "${iso(last)}" }) { sum { rowsRead } }`;
  const workers = (alias: string, last: Date) =>
    `${alias}: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: "${iso(dayStart)}", datetime_leq: "${endOfHour(last)}" }) { sum { requests } }`;
  const parts = [d1("d1Now", through), workers("workersNow", through)];
  if (before) parts.push(d1("d1Before", before), workers("workersBefore", before));
  return `query Usage($accountTag: string) { viewer { accounts(filter: { accountTag: $accountTag }) { ${parts.join(" ")} } } }`;
}

function total(
  account: Record<string, Array<{ sum?: { rowsRead?: number; requests?: number } }> | undefined>,
  alias: string,
  field: "rowsRead" | "requests",
) {
  return (account[alias] ?? []).reduce((sum, group) => sum + (group.sum?.[field] ?? 0), 0);
}

async function fetchTotals(
  env: Required<UsageEnv>,
  now: Date,
  fetcher: typeof fetch,
): Promise<{ totals: Totals; through: Date } | null> {
  const windows = usageWindows(now);
  if (!windows) return null;
  const response = await fetcher(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: usageQuery(windows.dayStart, windows.through, windows.before),
      variables: { accountTag: env.USAGE_ACCOUNT_ID },
    }),
  });
  const body = (await response.json()) as GraphqlResponse;
  const account = body.data?.viewer?.accounts?.[0];
  if (!response.ok || body.errors?.length || !account)
    throw new Error(
      `analytics query failed (${response.status}): ${body.errors?.map((e) => e.message).join("; ") ?? "no account"}`,
    );
  return {
    through: windows.through,
    totals: {
      d1RowsRead: { now: total(account, "d1Now", "rowsRead"), before: total(account, "d1Before", "rowsRead") },
      workerRequests: {
        now: total(account, "workersNow", "requests"),
        before: total(account, "workersBefore", "requests"),
      },
    },
  };
}

async function sendTelegram(env: Required<UsageEnv>, text: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_USAGE_CHAT_ID, text }),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!body.ok)
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body.description ?? "no description"}`);
}

/** Runs one hourly check. Returns the messages sent (for tests and logs). Errors are thrown to the cron handler. */
export async function runUsageAlert(env: UsageEnv, now = new Date(), fetcher: typeof fetch = fetch): Promise<string[]> {
  const missing = (
    ["USAGE_ACCOUNT_ID", "CF_ANALYTICS_TOKEN", "TELEGRAM_BOT_TOKEN", "TELEGRAM_USAGE_CHAT_ID"] as const
  ).filter((name) => !env[name]);
  if (missing.length) {
    console.warn(`usage alert skipped: ${missing.join(", ")} not set (see context/deploy-setup.md)`);
    return [];
  }
  const ready = env as Required<UsageEnv>;
  const result = await fetchTotals(ready, now, fetcher);
  if (!result) return [];

  const sent: string[] = [];
  for (const metric of Object.keys(DAILY_LIMITS) as UsageMetric[]) {
    const { now: current, before } = result.totals[metric];
    const level = crossedLevel(before, current, DAILY_LIMITS[metric]);
    if (level === null) continue;
    const text = alertMessage(metric, current, level, result.through);
    await sendTelegram(ready, text, fetcher);
    sent.push(text);
  }
  console.log(
    `usage check: D1 rows read ${result.totals.d1RowsRead.now}, Worker requests ${result.totals.workerRequests.now}, alerts sent ${sent.length}`,
  );
  return sent;
}

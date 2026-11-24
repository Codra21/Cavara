// Attack mode (P10.3, docs/abuse-defense-plan.md Layer 2). On the */5 cron: read the account's Worker requests for
// today and for the last 60 minutes, and switch one prepared WAF custom rule (a Managed Challenge on HTML page
// requests) on or off by the rules in src/domain/attack-mode.ts. It needs no D1, so it still works while D1 is
// blocked. Server-only.
//
// Cloudflare API, checked 2026-11-18:
//   GET   /zones/{zone_id}/rulesets/{ruleset_id}                  returns the ruleset with its rules[] (id, enabled,
//                                                                 last_updated, ...), developers.cloudflare.com/ruleset-engine/rulesets-api/view/
//   PATCH /zones/{zone_id}/rulesets/{ruleset_id}/rules/{rule_id}  edits one rule; "You must include all the rule fields
//                                                                 that you want to be part of the new rule definition",
//                                                                 developers.cloudflare.com/ruleset-engine/rulesets-api/update-rule/
// so the PATCH resends the rule's own definition with `enabled` changed. A rule without `enabled` is on. Token (secret
// CF_WAF_TOKEN): Zone WAF Write on the zone. Setup in docs/abuse-defense-plan.md. Analytics: the same GraphQL query
// the usage alert uses (workersInvocationsAdaptive.sum.requests), via queryAnalytics.
import { attackDecision, attackMessage, type AttackDecision, utcDayStart } from "@/domain/attack-mode";
import type { CloudflareEnv } from "@/server/db/d1";
import { queryAnalytics, sendTelegram, total } from "@/server/usage-alert.server";

const API = "https://api.cloudflare.com/client/v4";
const HOUR = 3_600_000;

type AttackEnv = Pick<
  CloudflareEnv,
  | "USAGE_ACCOUNT_ID"
  | "CF_ANALYTICS_TOKEN"
  | "CF_WAF_TOKEN"
  | "WAF_ZONE_ID"
  | "WAF_RULESET_ID"
  | "ATTACK_RULE_ID"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_USAGE_CHAT_ID"
>;

const REQUIRED = [
  "USAGE_ACCOUNT_ID",
  "CF_ANALYTICS_TOKEN",
  "CF_WAF_TOKEN",
  "WAF_ZONE_ID",
  "WAF_RULESET_ID",
  "ATTACK_RULE_ID",
] as const;
// The Telegram names are optional: without them the rule still switches, only the alert is left out.

interface RuleResponse {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { rules?: WafRule[] };
}

interface WafRule {
  id: string;
  enabled?: boolean;
  last_updated?: string;
  [field: string]: unknown;
}

/** The fields of a rule that a PATCH accepts back. `id`, `version`, `last_updated` and `categories` are read-only. */
const EDITABLE = ["action", "action_parameters", "expression", "description", "logging", "ref", "ratelimit"] as const;

/** The two request counts the decision needs, as one GraphQL query. Every value is an ISO timestamp computed here. */
export function requestsQuery(dayStart: Date, hourStart: Date, now: Date): string {
  const requests = (alias: string, from: Date) =>
    `${alias}: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: "${from.toISOString()}", datetime_leq: "${now.toISOString()}" }) { sum { requests } }`;
  return `query Requests($accountTag: string) { viewer { accounts(filter: { accountTag: $accountTag }) { ${requests("today", dayStart)} ${requests("lastHour", hourStart)} } } }`;
}

async function wafRequest(
  env: Required<AttackEnv>,
  fetcher: typeof fetch,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown,
): Promise<RuleResponse> {
  const response = await fetcher(`${API}/zones/${env.WAF_ZONE_ID}/rulesets/${env.WAF_RULESET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_WAF_TOKEN}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  const parsed = (await response.json().catch(() => ({}))) as RuleResponse;
  if (!response.ok || parsed.success === false) {
    const reasons = parsed.errors?.map((error) => error.message).join("; ") || "no detail";
    throw new Error(`WAF ${method} failed (${response.status}): ${reasons}`);
  }
  return parsed;
}

async function readRule(env: Required<AttackEnv>, fetcher: typeof fetch): Promise<WafRule> {
  const ruleset = await wafRequest(env, fetcher, "GET", "");
  const rule = ruleset.result?.rules?.find((entry) => entry.id === env.ATTACK_RULE_ID);
  if (!rule) throw new Error("WAF attack rule not found in the ruleset (check ATTACK_RULE_ID and WAF_RULESET_ID)");
  return rule;
}

async function setRule(env: Required<AttackEnv>, fetcher: typeof fetch, rule: WafRule, enabled: boolean) {
  const definition: Record<string, unknown> = { enabled };
  for (const field of EDITABLE) if (rule[field] !== undefined) definition[field] = rule[field];
  await wafRequest(env, fetcher, "PATCH", `/rules/${env.ATTACK_RULE_ID}`, definition);
}

export interface AttackReport {
  decision: AttackDecision;
  today: number;
  lastHour: number;
  message?: string;
}

/**
 * Runs one check. Returns null when a setting is missing (one warning, nothing else happens). Any API error is thrown
 * to the cron handler, and nothing is toggled when the counts or the rule could not be read. The Telegram message is
 * sent after the toggle took effect.
 */
export async function runAttackMode(
  env: AttackEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<AttackReport | null> {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    console.warn(`attack mode skipped: ${missing.join(", ")} not set`);
    return null;
  }
  const ready = env as Required<AttackEnv>;
  const canAlert = Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_USAGE_CHAT_ID?.trim());

  const account = await queryAnalytics(
    ready,
    requestsQuery(utcDayStart(now), new Date(now.getTime() - HOUR), now),
    fetcher,
  );
  const today = total(account, "today", "requests");
  const lastHour = total(account, "lastHour", "requests");

  const rule = await readRule(ready, fetcher);
  const decision = attackDecision({
    enabled: rule.enabled !== false,
    today,
    lastHour,
    now,
    ruleUpdatedAt: rule.last_updated ? new Date(rule.last_updated) : null,
  });
  if (decision === "keep") return { decision, today, lastHour };

  await setRule(ready, fetcher, rule, decision === "enable");
  const message = attackMessage(decision, today, lastHour);
  console.log(
    `attack mode ${decision === "enable" ? "ON" : "OFF"}: ${today} requests today, ${lastHour} in the last hour`,
  );
  if (canAlert) await sendTelegram(ready, message, fetcher);
  else console.warn("attack mode alert not sent: TELEGRAM_BOT_TOKEN or TELEGRAM_USAGE_CHAT_ID not set");
  return { decision, today, lastHour, message };
}

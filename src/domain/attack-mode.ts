// When to switch the prepared WAF attack-mode rule on and off (P10.3, docs/abuse-defense-plan.md Layer 2). Pure: no
// fetch, no env. The Free plan stops the Worker for the rest of the UTC day at 100,000 requests, so the rule that
// gives every page request a Managed Challenge goes on while the day is on course to run out.
import { DAILY_LIMITS } from "./usage";

/** Free plan Worker requests per UTC day (the same limit the usage alert watches). */
export const DAILY_REQUEST_LIMIT = DAILY_LIMITS.workerRequests;

/**
 * Turn on at this many requests today, whatever the time. 70% of the day's limit leaves 30,000 requests of room for
 * the challenge to take effect before the Worker stops at 100,000.
 */
export const ATTACK_ON_TODAY = 70_000;

/**
 * Turn on early when the day is running ahead of pace: today above 1.5 times what an even day would have used by now
 * (100,000 times the fraction of the UTC day gone), once at least 25,000 requests are in. The floor stops a quiet
 * night from tripping it (at 00:30 UTC an even pace is 2,083 requests, so 1.5 times that is 3,125). The slow-bot
 * example the plan guards against is 100 IPs sending 9 requests per 5 minutes, about 259,000 a day. That is under any
 * per-IP rate limit, and it reaches the 25,000 floor, already past the pace line, about 2.3 hours into the day.
 */
export const ATTACK_ON_FLOOR = 25_000;
export const ATTACK_ON_PACE_FACTOR = 1.5;

/** Turn off only after the rule has been on this long, so a flapping rule cannot switch every 5 minutes. */
export const ATTACK_MIN_ON_MS = 60 * 60 * 1000;
/** ...and when the last 60 minutes brought fewer requests than this (a normal busy hour is a few hundred). */
export const ATTACK_QUIET_HOUR = 3_000;
/** ...and the day is not near the limit. At this total the rule stays on until the 00:00 UTC reset. */
export const ATTACK_OFF_CEILING = 90_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight that starts the day `now` is in. */
export const utcDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Fraction of the UTC day gone, 0 at 00:00 and just under 1 at 23:59. */
export const dayFraction = (now: Date) => (now.getTime() - utcDayStart(now).getTime()) / DAY_MS;

export interface AttackInputs {
  /** Whether the prepared rule is switched on right now. */
  enabled: boolean;
  /** Worker requests so far today (UTC), account-wide. */
  today: number;
  /** Worker requests in the last 60 minutes. */
  lastHour: number;
  now: Date;
  /** When the rule last changed (the API's `last_updated`). Null or invalid: unknown, so a rule that is on stays on. */
  ruleUpdatedAt: Date | null;
}

export type AttackDecision = "enable" | "disable" | "keep";

export function attackDecision(input: AttackInputs): AttackDecision {
  const { enabled, today, lastHour, now, ruleUpdatedAt } = input;
  if (!enabled) {
    const pace = ATTACK_ON_PACE_FACTOR * DAILY_REQUEST_LIMIT * dayFraction(now);
    return today >= ATTACK_ON_TODAY || (today >= ATTACK_ON_FLOOR && today > pace) ? "enable" : "keep";
  }
  const onFor =
    ruleUpdatedAt && !Number.isNaN(ruleUpdatedAt.getTime()) ? now.getTime() - ruleUpdatedAt.getTime() : null;
  return onFor !== null && onFor >= ATTACK_MIN_ON_MS && lastHour < ATTACK_QUIET_HOUR && today < ATTACK_OFF_CEILING
    ? "disable"
    : "keep";
}

const n = (value: number) => value.toLocaleString("en-US");

export function attackMessage(decision: "enable" | "disable", today: number, lastHour: number): string {
  const percent = Math.floor((today / DAILY_REQUEST_LIMIT) * 100);
  const counts = `${n(today)} Worker requests today (${percent}% of ${n(DAILY_REQUEST_LIMIT)}), ${n(lastHour)} in the last hour.`;
  return decision === "enable"
    ? `Cavara attack mode ON. ${counts}\nEvery page request now gets a Managed Challenge. It switches off after a quiet hour.`
    : `Cavara attack mode OFF. ${counts}\nPage requests no longer get the challenge.`;
}

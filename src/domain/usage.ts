// Free plan daily limits and the alert rules for them. Pure: no fetch, no env.
// Both limits reset at 00:00 UTC (D1: the 2026-11-06 block email; Workers:
// https://developers.cloudflare.com/workers/platform/limits/).

export const DAILY_LIMITS = {
  d1RowsRead: 5_000_000,
  workerRequests: 100_000,
} as const;

export type UsageMetric = keyof typeof DAILY_LIMITS;

export const METRIC_LABELS: Record<UsageMetric, string> = {
  d1RowsRead: "D1 rows read",
  workerRequests: "Worker requests",
};

/** Fractions of a limit that send an alert, lowest first. */
export const ALERT_LEVELS = [0.6, 0.9] as const;

const HOUR = 3_600_000;

/**
 * The windows an hourly run compares, all within today (UTC). `through` is the start of the last complete hour,
 * `before` the start of the hour before it, or null when that falls before midnight (nothing counted yet).
 * Returns null in the first hour of the day: no hour of today is complete, and yesterday's total has reset.
 */
export function usageWindows(now: Date): { dayStart: Date; through: Date; before: Date | null } | null {
  const hourStart = Math.floor(now.getTime() / HOUR) * HOUR;
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const through = hourStart - HOUR;
  if (through < dayStart) return null;
  const before = through - HOUR;
  return {
    dayStart: new Date(dayStart),
    through: new Date(through),
    before: before < dayStart ? null : new Date(before),
  };
}

/**
 * The highest alert level crossed between two cumulative totals, or null. Comparing totals an hour apart, rather
 * than storing what was sent, keeps the check stateless: each level fires once a day, in the hour it is crossed.
 */
export function crossedLevel(before: number, now: number, limit: number): number | null {
  let crossed: number | null = null;
  for (const level of ALERT_LEVELS) if (before < level * limit && now >= level * limit) crossed = level;
  return crossed;
}

export function alertMessage(metric: UsageMetric, total: number, level: number, through: Date): string {
  const limit = DAILY_LIMITS[metric];
  const percent = Math.floor((total / limit) * 100);
  const hour = new Date(through.getTime() + HOUR).toISOString().slice(11, 16);
  const urgent = level >= 0.9;
  const lines = [
    `${urgent ? "URGENT: " : ""}Cavara ${METRIC_LABELS[metric]} at ${percent}% of today's Free plan limit`,
    `${total.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} by ${hour} UTC. Resets at 00:00 UTC.`,
  ];
  if (urgent)
    lines.push(
      metric === "d1RowsRead"
        ? "At 100% every D1 read fails until the reset (the shop keeps serving the R2 catalogue snapshot)."
        : "At 100% the site returns Error 1027 until the reset.",
    );
  return lines.join("\n");
}

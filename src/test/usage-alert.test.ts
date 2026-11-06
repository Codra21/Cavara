import { describe, expect, test } from "bun:test";
import { alertMessage, crossedLevel, usageWindows } from "@/domain/usage";
import { runUsageAlert, usageQuery } from "@/server/usage-alert.server";

const at = (iso: string) => new Date(iso);
const env = {
  USAGE_ACCOUNT_ID: "acct",
  CF_ANALYTICS_TOKEN: "token",
  TELEGRAM_BOT_TOKEN: "bot",
  TELEGRAM_USAGE_CHAT_ID: "chat",
};

describe("usageWindows", () => {
  test("compares the last complete hour with the one before", () => {
    expect(usageWindows(at("2026-11-06T14:10:00Z"))).toEqual({
      dayStart: at("2026-11-06T00:00:00Z"),
      through: at("2026-11-06T13:00:00Z"),
      before: at("2026-11-06T12:00:00Z"),
    });
  });

  test("skips the first hour of the UTC day and has no 'before' in the second", () => {
    expect(usageWindows(at("2026-11-06T00:10:00Z"))).toBeNull();
    expect(usageWindows(at("2026-11-06T01:10:00Z"))?.before).toBeNull();
  });
});

describe("crossedLevel", () => {
  test("fires only in the hour a level is crossed, highest level wins", () => {
    expect(crossedLevel(2_900_000, 3_000_000, 5_000_000)).toBe(0.6);
    expect(crossedLevel(3_000_000, 3_500_000, 5_000_000)).toBeNull();
    expect(crossedLevel(4_000_000, 4_600_000, 5_000_000)).toBe(0.9);
    expect(crossedLevel(1_000_000, 4_600_000, 5_000_000)).toBe(0.9);
    expect(crossedLevel(0, 100, 5_000_000)).toBeNull();
  });
});

test("alertMessage names the metric, totals and reset", () => {
  const text = alertMessage("d1RowsRead", 3_050_000, 0.6, at("2026-11-06T13:00:00Z"));
  expect(text).toContain("D1 rows read at 61%");
  expect(text).toContain("3,050,000 of 5,000,000 by 14:00 UTC");
  expect(alertMessage("workerRequests", 91_000, 0.9, at("2026-11-06T13:00:00Z"))).toStartWith("URGENT:");
});

test("usageQuery interpolates only the computed timestamps", () => {
  const query = usageQuery(at("2026-11-06T00:00:00Z"), at("2026-11-06T13:00:00Z"), null);
  expect(query).toContain('datetimeHour_leq: "2026-11-06T13:00:00.000Z"');
  expect(query).toContain('datetime_leq: "2026-11-06T13:59:59.000Z"');
  expect(query).not.toContain("d1Before");
});

describe("runUsageAlert", () => {
  function fakeFetch(account: Record<string, unknown>) {
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.includes("graphql")) return Response.json({ data: { viewer: { accounts: [account] } } });
      return Response.json({ ok: true, result: {} });
    }) as unknown as typeof fetch;
    return { calls, fetcher };
  }

  test("sends one Telegram message per crossed metric to the usage chat", async () => {
    const { calls, fetcher } = fakeFetch({
      d1Now: [{ sum: { rowsRead: 3_100_000 } }],
      d1Before: [{ sum: { rowsRead: 2_000_000 } }],
      workersNow: [{ sum: { requests: 5_000 } }],
      workersBefore: [{ sum: { requests: 4_000 } }],
    });
    const sent = await runUsageAlert(env, at("2026-11-06T14:10:00Z"), fetcher);
    expect(sent).toHaveLength(1);
    const telegram = calls.filter((call) => call.url.includes("api.telegram.org"));
    expect(telegram).toHaveLength(1);
    expect(telegram[0]?.url).toBe("https://api.telegram.org/botbot/sendMessage");
    expect(telegram[0]?.body).toMatchObject({ chat_id: "chat" });
  });

  test("does nothing and calls nothing when a secret is missing", async () => {
    const { calls, fetcher } = fakeFetch({});
    expect(await runUsageAlert({ ...env, TELEGRAM_USAGE_CHAT_ID: "" }, at("2026-11-06T14:10:00Z"), fetcher)).toEqual(
      [],
    );
    expect(calls).toHaveLength(0);
  });

  test("throws on GraphQL errors so the cron logs them", async () => {
    const fetcher = (async () => Response.json({ errors: [{ message: "not authorized" }] })) as unknown as typeof fetch;
    await expect(runUsageAlert(env, at("2026-11-06T14:10:00Z"), fetcher)).rejects.toThrow("not authorized");
  });
});

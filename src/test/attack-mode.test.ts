import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { attackDecision, dayFraction } from "@/domain/attack-mode";
import { requestsQuery, runAttackMode } from "@/server/attack-mode.server";

const at = (iso: string) => new Date(iso);
const env = {
  USAGE_ACCOUNT_ID: "acct",
  CF_ANALYTICS_TOKEN: "analytics-token",
  CF_WAF_TOKEN: "waf-token-secret",
  WAF_ZONE_ID: "zone1",
  WAF_RULESET_ID: "ruleset1",
  ATTACK_RULE_ID: "rule1",
  TELEGRAM_BOT_TOKEN: "bot",
  TELEGRAM_USAGE_CHAT_ID: "chat",
};

describe("attackDecision", () => {
  const base = { enabled: false, today: 0, lastHour: 0, now: at("2026-11-18T12:00:00Z"), ruleUpdatedAt: null };

  test("dayFraction is the share of the UTC day gone", () => {
    expect(dayFraction(at("2026-11-18T00:00:00Z"))).toBe(0);
    expect(dayFraction(at("2026-11-18T12:00:00Z"))).toBe(0.5);
  });

  test("turns on at 70,000 requests at any hour", () => {
    expect(attackDecision({ ...base, today: 69_999, now: at("2026-11-18T23:00:00Z") })).toBe("keep");
    expect(attackDecision({ ...base, today: 70_000, now: at("2026-11-18T23:59:00Z") })).toBe("enable");
  });

  test("turns on early when ahead of 1.5 times the even pace, but only from 25,000", () => {
    // 06:00 UTC: an even pace is 25,000, so the line is 37,500.
    const morning = at("2026-11-18T06:00:00Z");
    expect(attackDecision({ ...base, today: 37_500, now: morning })).toBe("keep");
    expect(attackDecision({ ...base, today: 37_501, now: morning })).toBe("enable");
    // 01:00 UTC: the line is 6,250, far over it at 20,000, but under the 25,000 floor.
    expect(attackDecision({ ...base, today: 20_000, now: at("2026-11-18T01:00:00Z") })).toBe("keep");
    expect(attackDecision({ ...base, today: 25_000, now: at("2026-11-18T01:00:00Z") })).toBe("enable");
  });

  test("a rule that is already on is never turned on again", () => {
    expect(attackDecision({ ...base, enabled: true, today: 80_000, lastHour: 9_000 })).toBe("keep");
  });

  test("turns off after the rule has been on 60 minutes and the last hour was quiet", () => {
    const on = { ...base, enabled: true, today: 60_000, lastHour: 2_999 };
    expect(attackDecision({ ...on, ruleUpdatedAt: at("2026-11-18T10:59:00Z") })).toBe("disable");
    expect(attackDecision({ ...on, ruleUpdatedAt: at("2026-11-18T11:00:00Z") })).toBe("disable");
    expect(attackDecision({ ...on, ruleUpdatedAt: at("2026-11-18T11:00:01Z") })).toBe("keep");
    expect(attackDecision({ ...on, lastHour: 3_000, ruleUpdatedAt: at("2026-11-18T09:00:00Z") })).toBe("keep");
    expect(attackDecision({ ...on, today: 90_000, ruleUpdatedAt: at("2026-11-18T09:00:00Z") })).toBe("keep");
    expect(attackDecision({ ...on, today: 89_999, ruleUpdatedAt: at("2026-11-18T09:00:00Z") })).toBe("disable");
  });

  test("an unknown or invalid last_updated keeps a rule that is on", () => {
    const on = { ...base, enabled: true, today: 1_000, lastHour: 10 };
    expect(attackDecision({ ...on, ruleUpdatedAt: null })).toBe("keep");
    expect(attackDecision({ ...on, ruleUpdatedAt: new Date("not a date") })).toBe("keep");
  });
});

test("requestsQuery interpolates only computed timestamps", () => {
  const query = requestsQuery(at("2026-11-18T00:00:00Z"), at("2026-11-18T11:00:00Z"), at("2026-11-18T12:00:00Z"));
  expect(query).toContain(
    'today: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: "2026-11-18T00:00:00.000Z"',
  );
  expect(query).toContain(
    'lastHour: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: "2026-11-18T11:00:00.000Z"',
  );
  expect(query).toContain('datetime_leq: "2026-11-18T12:00:00.000Z"');
});

describe("runAttackMode", () => {
  const NOW = at("2026-11-18T12:00:00Z");
  const RULE = {
    id: "rule1",
    version: "3",
    action: "managed_challenge",
    expression: '(http.request.uri.path ne "/_serverFn/")',
    description: "attack mode",
    last_updated: "2026-11-18T09:00:00.000Z",
    ref: "abc",
    categories: ["x"],
  };

  /** A fake Cloudflare: GraphQL counts, a zone ruleset with one rule, a PATCH recorder and Telegram. */
  function fake(opts: {
    today: number;
    lastHour: number;
    rule?: Record<string, unknown>;
    graphqlStatus?: number;
    getStatus?: number;
    patchStatus?: number;
  }) {
    const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.includes("graphql")) {
        if (opts.graphqlStatus)
          return Response.json({ errors: [{ message: "denied" }] }, { status: opts.graphqlStatus });
        return Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  today: [{ sum: { requests: opts.today } }],
                  lastHour: [{ sum: { requests: opts.lastHour } }],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/rulesets/") && method === "GET") {
        if (opts.getStatus)
          return Response.json({ success: false, errors: [{ message: "no access" }] }, { status: opts.getStatus });
        return Response.json({ success: true, result: { rules: [{ id: "other" }, opts.rule ?? RULE] } });
      }
      if (url.includes("/rulesets/") && method === "PATCH") {
        if (opts.patchStatus)
          return Response.json({ success: false, errors: [{ message: "bad rule" }] }, { status: opts.patchStatus });
        return Response.json({ success: true, result: {} });
      }
      return Response.json({ ok: true, result: {} });
    }) as unknown as typeof fetch;
    const patches = () => calls.filter((call) => call.method === "PATCH");
    const telegrams = () => calls.filter((call) => call.url.includes("api.telegram.org"));
    return { calls, fetcher, patches, telegrams };
  }

  let warn: ReturnType<typeof spyOn>;
  let error: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
    error = spyOn(console, "error").mockImplementation(() => {});
    spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  test("turns the rule on, resends its definition and sends one Telegram message", async () => {
    const { fetcher, patches, telegrams, calls } = fake({
      today: 71_000,
      lastHour: 9_000,
      rule: { ...RULE, enabled: false, last_updated: "2026-11-17T20:00:00.000Z" },
    });
    const report = await runAttackMode(env, NOW, fetcher);
    expect(report).toMatchObject({ decision: "enable", today: 71_000, lastHour: 9_000 });
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.url).toBe("https://api.cloudflare.com/client/v4/zones/zone1/rulesets/ruleset1/rules/rule1");
    // Read-only fields are not sent back; the editable ones are, so the PATCH keeps the rule as it was.
    expect(patches()[0]!.body).toEqual({
      enabled: true,
      action: "managed_challenge",
      expression: RULE.expression,
      description: "attack mode",
      ref: "abc",
    });
    expect(patches()[0]!.headers.Authorization).toBe("Bearer waf-token-secret");
    expect(telegrams()).toHaveLength(1);
    expect((telegrams()[0]!.body as { text: string }).text).toStartWith("Cavara attack mode ON.");
    // The WAF token goes to the WAF API only, never to Telegram or the analytics call or any message.
    expect(JSON.stringify(calls.filter((call) => !call.url.includes("/rulesets/")))).not.toContain("waf-token-secret");
    expect(JSON.stringify(report)).not.toContain("waf-token-secret");
  });

  test("stays on while traffic is still high", async () => {
    const { fetcher, patches, telegrams } = fake({ today: 80_000, lastHour: 9_000, rule: { ...RULE, enabled: true } });
    expect(await runAttackMode(env, NOW, fetcher)).toMatchObject({ decision: "keep" });
    expect(patches()).toHaveLength(0);
    expect(telegrams()).toHaveLength(0);
  });

  test("a rule with no enabled field counts as on", async () => {
    const { fetcher, patches } = fake({ today: 80_000, lastHour: 9_000 });
    expect(await runAttackMode(env, NOW, fetcher)).toMatchObject({ decision: "keep" });
    expect(patches()).toHaveLength(0);
  });

  test("turns off after a quiet hour and says so", async () => {
    const { fetcher, patches, telegrams } = fake({
      today: 60_000,
      lastHour: 800,
      rule: { ...RULE, enabled: true, last_updated: "2026-11-18T09:00:00.000Z" },
    });
    const report = await runAttackMode(env, NOW, fetcher);
    expect(report).toMatchObject({ decision: "disable" });
    expect(patches()[0]!.body).toMatchObject({ enabled: false, action: "managed_challenge" });
    expect((telegrams()[0]!.body as { text: string }).text).toStartWith("Cavara attack mode OFF.");
  });

  test("does nothing on a normal day", async () => {
    const { fetcher, patches, telegrams } = fake({ today: 3_000, lastHour: 200, rule: { ...RULE, enabled: false } });
    expect(await runAttackMode(env, NOW, fetcher)).toMatchObject({ decision: "keep" });
    expect(patches()).toHaveLength(0);
    expect(telegrams()).toHaveLength(0);
  });

  test("trims whitespace around environment secrets and ids before calling Cloudflare or Telegram", async () => {
    const urls: string[] = [];
    const headers: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth) headers.push(auth);
      if (url.includes("/graphql")) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [{ today: [{ sum: { requests: 80_000 } }], lastHour: [{ sum: { requests: 20_000 } }] }],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/rulesets/") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            success: true,
            result: { rules: [{ id: "rule-1", enabled: false, action: "managed_challenge", expression: "true" }] },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true, ok: true }), { status: 200 });
    }) as typeof fetch;

    const report = await runAttackMode(
      {
        USAGE_ACCOUNT_ID: " acc-1 \n",
        CF_ANALYTICS_TOKEN: " tok-a \n",
        CF_WAF_TOKEN: " tok-w \n",
        WAF_ZONE_ID: " zone-1 ",
        WAF_RULESET_ID: " rs-1 ",
        ATTACK_RULE_ID: " rule-1 ",
        TELEGRAM_BOT_TOKEN: " bot-1 \n",
        TELEGRAM_USAGE_CHAT_ID: " chat-1 ",
      },
      new Date("2026-11-15T12:00:00Z"),
      fetcher,
    );
    expect(report?.decision).toBe("enable");
    expect(urls.every((u) => !/\s/.test(u))).toBe(true);
    expect(headers.every((h) => !/\r|\n/.test(h) && !h.endsWith(" "))).toBe(true);
  });

  test("skips with one warning when a setting is missing, without calling anything", async () => {
    const required = (Object.keys(env) as (keyof typeof env)[]).filter((name) => !name.startsWith("TELEGRAM_"));
    for (const name of required) {
      const { fetcher, calls } = fake({ today: 99_000, lastHour: 9_000 });
      warn.mockClear();
      expect(await runAttackMode({ ...env, [name]: "" }, NOW, fetcher)).toBeNull();
      expect(calls).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(name);
    }
    const { fetcher, calls } = fake({ today: 1, lastHour: 1 });
    expect(await runAttackMode({}, NOW, fetcher)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("without the Telegram settings the rule still switches and no alert is sent", async () => {
    const { fetcher, patches, telegrams } = fake({ today: 99_000, lastHour: 9_000, rule: { ...RULE, enabled: false } });
    const report = await runAttackMode({ ...env, TELEGRAM_BOT_TOKEN: "", TELEGRAM_USAGE_CHAT_ID: "" }, NOW, fetcher);
    expect(report).toMatchObject({ decision: "enable" });
    expect(patches()).toHaveLength(1);
    expect(telegrams()).toHaveLength(0);
  });

  test("an analytics error is thrown and nothing is toggled", async () => {
    const { fetcher, patches, telegrams } = fake({ today: 99_000, lastHour: 9_000, graphqlStatus: 403 });
    await expect(runAttackMode(env, NOW, fetcher)).rejects.toThrow("analytics query failed (403)");
    expect(patches()).toHaveLength(0);
    expect(telegrams()).toHaveLength(0);
  });

  test("a failed rule read is thrown and nothing is toggled", async () => {
    const { fetcher, patches } = fake({ today: 99_000, lastHour: 9_000, getStatus: 403 });
    await expect(runAttackMode(env, NOW, fetcher)).rejects.toThrow("WAF GET failed (403): no access");
    expect(patches()).toHaveLength(0);
  });

  test("a rule id that is not in the ruleset is thrown", async () => {
    const { fetcher, patches } = fake({ today: 99_000, lastHour: 9_000 });
    await expect(runAttackMode({ ...env, ATTACK_RULE_ID: "missing" }, NOW, fetcher)).rejects.toThrow(
      "WAF attack rule not found",
    );
    expect(patches()).toHaveLength(0);
  });

  test("a failed PATCH is thrown and sends no Telegram message", async () => {
    const { fetcher, telegrams } = fake({
      today: 99_000,
      lastHour: 9_000,
      rule: { ...RULE, enabled: false },
      patchStatus: 400,
    });
    await expect(runAttackMode(env, NOW, fetcher)).rejects.toThrow("WAF PATCH failed (400): bad rule");
    expect(telegrams()).toHaveLength(0);
  });
});

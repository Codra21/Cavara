import { describe, expect, test } from "bun:test";
import { rateLimitSubject } from "@/domain/rate-limit-subject";
import { consumeOrderLimits } from "@/server/db/orders.repository";
import { consumeLimits, limitSweepSql, limitUpsertSql, SWEEP_ONE_IN } from "@/server/db/rate-limits";
import { createTestD1, type TestD1 } from "./helpers/d1";

const NOW = Date.parse("2026-11-15T06:00:00.000Z");
const WINDOW = 15 * 60_000;

describe("rateLimitSubject", () => {
  test("IPv4 stays as it is", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  test("IPv6 is cut to its /64, in any spelling", () => {
    const want = "2001:db8:0:0::/64";
    expect(rateLimitSubject("2001:db8::1")).toBe(want);
    expect(rateLimitSubject("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(want);
    expect(rateLimitSubject("2001:DB8::ffff:ffff:ffff:ffff")).toBe(want);
    expect(rateLimitSubject("[2001:db8::1]")).toBe(want);
    expect(rateLimitSubject("2001:db8::1%eth0")).toBe(want);
    // Two hosts in one /64 share a subject; another /64 does not.
    expect(rateLimitSubject("2001:db8:1:2:aaaa::1")).toBe(rateLimitSubject("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
    expect(rateLimitSubject("2001:db8:1:2::1")).not.toBe(rateLimitSubject("2001:db8:1:3::1"));
    expect(rateLimitSubject("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitSubject("::")).toBe("0:0:0:0::/64");
    expect(rateLimitSubject("fe80::1")).toBe("fe80:0:0:0::/64");
  });

  test("an IPv4-mapped IPv6 address counts as the IPv4 address", () => {
    expect(rateLimitSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitSubject("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("junk never throws and stays in one bounded bucket", () => {
    for (const junk of [
      "",
      "   ",
      "local",
      "not an ip",
      "1.2.3",
      "1.2.3.4.5",
      "999.1.1.1",
      "1:2:3",
      ":::",
      "2001:::1",
      "g::1",
    ]) {
      const subject = rateLimitSubject(junk);
      expect(typeof subject).toBe("string");
      expect(subject.length).toBeGreaterThan(0);
      expect(subject.length).toBeLessThanOrEqual(64);
    }
    expect(rateLimitSubject("")).toBe("unknown");
    expect(rateLimitSubject("local")).toBe("local");
    expect(rateLimitSubject("x".repeat(500)).length).toBe(64);
    // Not a /64 prefix of something else by accident.
    expect(rateLimitSubject("1:2:3")).toBe("1:2:3");
  });
});

const attemptsOf = (db: TestD1, key: string) =>
  (db.sqlite.query("SELECT attempts FROM order_rate_limits WHERE key = ?").get(key) as { attempts: number } | null)
    ?.attempts ?? null;
const changes = (db: TestD1) => (db.sqlite.query("SELECT total_changes() AS n").get() as { n: number }).n;

describe("consumeOrderLimits", () => {
  test("allows up to max attempts, then refuses without writing again", async () => {
    const db = createTestD1();
    const limit = [{ key: "k", max: 3 }];
    for (let i = 0; i < 3; i++) expect(await consumeOrderLimits(db, limit, NOW, WINDOW, false)).toBe(true);
    expect(attemptsOf(db, "k")).toBe(3);

    const before = changes(db);
    for (let i = 0; i < 100; i++) expect(await consumeOrderLimits(db, limit, NOW + i, WINDOW, false)).toBe(false);
    // 100 refused calls: the counter stays at the limit and not one row was written.
    expect(attemptsOf(db, "k")).toBe(3);
    expect(changes(db)).toBe(before);
  });

  test("a call without a sweep never deletes; a sweep deletes expired rows only", async () => {
    const db = createTestD1();
    await consumeOrderLimits(db, [{ key: "old", max: 5 }], NOW, WINDOW, false);
    await consumeOrderLimits(db, [{ key: "new", max: 5 }], NOW + WINDOW, WINDOW, false);
    expect(attemptsOf(db, "old")).toBe(1);
    await consumeOrderLimits(db, [{ key: "new", max: 5 }], NOW + WINDOW + 1, WINDOW, true);
    expect(attemptsOf(db, "old")).toBeNull();
    expect(attemptsOf(db, "new")).toBe(2);
  });

  test("an expired row starts a new window in place, even without a sweep", async () => {
    const db = createTestD1();
    const limit = [{ key: "k", max: 2 }];
    await consumeOrderLimits(db, limit, NOW, WINDOW, false);
    await consumeOrderLimits(db, limit, NOW, WINDOW, false);
    expect(await consumeOrderLimits(db, limit, NOW, WINDOW, false)).toBe(false);
    expect(await consumeOrderLimits(db, limit, NOW + WINDOW, WINDOW, false)).toBe(true);
    expect(attemptsOf(db, "k")).toBe(1);
    expect(db.sqlite.query("SELECT expires_at FROM order_rate_limits WHERE key = 'k'").get()).toEqual({
      expires_at: NOW + 2 * WINDOW,
    });
    // A blocked call does not extend the window.
    await consumeOrderLimits(db, limit, NOW + WINDOW, WINDOW, false);
    expect(await consumeOrderLimits(db, limit, NOW + WINDOW, WINDOW, false)).toBe(false);
    expect(db.sqlite.query("SELECT expires_at FROM order_rate_limits WHERE key = 'k'").get()).toEqual({
      expires_at: NOW + 2 * WINDOW,
    });
  });

  test("every key is counted and all must be within limit", async () => {
    const db = createTestD1();
    const limits = [
      { key: "ip", max: 5 },
      { key: "phone", max: 1 },
    ];
    expect(await consumeOrderLimits(db, limits, NOW, WINDOW, false)).toBe(true);
    expect(await consumeOrderLimits(db, limits, NOW, WINDOW, false)).toBe(false);
    expect(attemptsOf(db, "ip")).toBe(2);
    expect(attemptsOf(db, "phone")).toBe(1);
  });

  test("the default sweeps on about 1 call in SWEEP_ONE_IN, so the table stays bounded", async () => {
    const db = createTestD1();
    for (let i = 0; i < 300; i++) {
      // A new key each call, each expired by the next, as a stream of one-off visitors would be.
      await consumeLimits(db, "order_rate_limits", [{ key: `visitor-${i}`, max: 5 }], NOW + i * WINDOW, WINDOW);
    }
    const left = (db.sqlite.query("SELECT count(*) AS n FROM order_rate_limits").get() as { n: number }).n;
    expect(left).toBeLessThan(300 / 2);
    expect(SWEEP_ONE_IN).toBeGreaterThan(1);
  });

  test("query plans: the upsert is a primary key probe and the sweep a range on the expiry index", () => {
    const db = createTestD1();
    const plan = (sql: string, ...params: (string | number)[]) =>
      (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map(
        (row) => row.detail,
      );
    for (const table of ["order_rate_limits", "admin_login_limits"] as const) {
      const upsert = plan(limitUpsertSql(table), "k", NOW, NOW, NOW, NOW, 5);
      const sweep = plan(limitSweepSql(table), NOW);
      if (process.env.SHOW_PLANS) console.log(table, { upsert, sweep });
      expect(upsert.join(" ")).not.toMatch(/SCAN|TEMP B-TREE/);
      expect(sweep.join(" ")).toMatch(/SEARCH \w+ USING (COVERING )?INDEX idx_\w+_(expires|expiry)/);
      expect(sweep.join(" ")).not.toMatch(/SCAN|TEMP B-TREE/);
    }
  });
});

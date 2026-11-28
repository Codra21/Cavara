import { describe, expect, test } from "bun:test";
import type { R2Bucket, R2ObjectBody } from "@/server/db/d1";
import {
  currentTiming,
  formatServerTiming,
  resetColdStartForTest,
  runWithRequestTiming,
  timedD1,
  timedR2,
  withServerTiming,
} from "@/server/timing.server";
import { createTestD1 } from "./helpers/d1";

function fakeBucket(): R2Bucket {
  return {
    get: async () => ({ text: async () => "{}" }) as unknown as R2ObjectBody,
    put: async () => null,
    delete: async () => {},
  };
}

describe("Server-Timing", () => {
  test("counts each query and each batch as one D1 round trip, and batches still run", async () => {
    const db = timedD1(createTestD1());
    await runWithRequestTiming(async () => {
      await db.prepare("SELECT 1 AS one").first();
      await db.prepare("SELECT ? AS n").bind(2).all();
      // The wrapped statements are unwrapped before the binding's batch(); the test D1 would throw otherwise.
      const results = await db.batch([db.prepare("SELECT 3 AS n"), db.prepare("SELECT ? AS n").bind(4)]);
      expect(results.map((r) => (r.results as { n: number }[])[0]?.n)).toEqual([3, 4]);
      expect(currentTiming()?.d1.count).toBe(3);
    });
  });

  test("parallel reads count separately but their time overlaps once", async () => {
    const db = timedD1(createTestD1());
    await runWithRequestTiming(async () => {
      await Promise.all([db.prepare("SELECT 1").all(), db.prepare("SELECT 2").all(), db.prepare("SELECT 3").all()]);
      const state = currentTiming()!;
      expect(state.d1.count).toBe(3);
      expect(state.d1.inFlight).toBe(0);
      expect(state.d1.ms).toBeLessThanOrEqual(performance.now() - state.start);
    });
  });

  test("outside a request the wrappers just pass through", async () => {
    expect(currentTiming()).toBeUndefined();
    expect(await timedD1(createTestD1()).prepare("SELECT 5 AS n").first()).toEqual({ n: 5 });
  });

  test("GET responses carry the header with D1 and R2 counts; POST responses don't", async () => {
    resetColdStartForTest();
    const db = timedD1(createTestD1());
    const bucket = timedR2(fakeBucket());
    const page = await withServerTiming(new Request("https://cavarabd.com/products"), async () => {
      await bucket.get("snapshots/catalog-v4.json");
      await db.prepare("SELECT 1").first();
      return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    });
    const header = page.headers.get("Server-Timing") ?? "";
    expect(header).toContain("d1;dur=");
    expect(header).toContain('desc="1 trip"');
    expect(header).toContain('desc="1 read"');
    expect(header).toContain("cold;desc=1");
    expect(await page.text()).toBe("<html></html>");

    const order = await withServerTiming(
      new Request("https://cavarabd.com/_serverFn/x", { method: "POST" }),
      async () => {
        await db.prepare("SELECT 1").first();
        return new Response("{}");
      },
    );
    expect(order.headers.has("Server-Timing")).toBe(false);
  });

  test("a page served from snapshots reports zero D1 trips, and only the first request is cold", async () => {
    resetColdStartForTest();
    await withServerTiming(new Request("https://cavarabd.com/"), async () => new Response("a"));
    const second = await withServerTiming(new Request("https://cavarabd.com/"), async () => new Response("b"));
    const header = second.headers.get("Server-Timing") ?? "";
    expect(header).toContain('d1;dur=0.0;desc="0 trips"');
    expect(header).toContain("cold;desc=0");
  });

  test("the header keeps redirects and their status", async () => {
    const response = await withServerTiming(new Request("https://cavarabd.com/collections/old"), async () =>
      Response.redirect("https://cavarabd.com/collections/new", 301),
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://cavarabd.com/collections/new");
    expect(response.headers.has("Server-Timing")).toBe(true);
  });

  test("format lists d1, r2, total and cold", () => {
    const state = {
      start: 0,
      cold: false,
      d1: { count: 2, ms: 12.34, inFlight: 0, openedAt: 0 },
      r2: { count: 1, ms: 4, inFlight: 0, openedAt: 0 },
    };
    expect(formatServerTiming(state, 30)).toBe(
      'd1;dur=12.3;desc="2 trips", r2;dur=4.0;desc="1 read", total;dur=30.0, cold;desc=0',
    );
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_SECONDS } from "@/domain/admin";
import { signIn, signOut } from "@/server/admin/auth.server";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner = { username: "owner", secret: "a-long-test-secret-value-1234567890" };
const good = { username: "owner", password: owner.secret, client: "203.0.113.7" };
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

const mockEnv: Record<string, unknown> = {};
let mockCookieValue: string | undefined;
const deletedCookies: Array<{ name: string; options: Record<string, unknown> }> = [];
const responseHeaders: Array<[string, string]> = [];

mock.module("cloudflare:workers", () => ({
  env: mockEnv,
  waitUntil() {},
}));

mock.module("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => (name === ADMIN_SESSION_COOKIE ? mockCookieValue : undefined),
  setCookie: () => {},
  deleteCookie: (name: string, options: Record<string, unknown>) => {
    deletedCookies.push({ name, options });
  },
  getRequest: () => new Request("https://cavarabd.com/admin"),
  getRequestHeader: () => undefined,
  setResponseHeader: (name: string, value: string) => {
    responseHeaders.push([name, value]);
  },
}));

const { signOutWithCookie } = await import("@/server/admin/session.server");

function trackDb() {
  const queries: string[] = [];
  let batchCalls = 0;
  const base = createTestD1({
    observe: (sql) => {
      queries.push(sql);
    },
  });
  const db: TestD1 = {
    ...base,
    batch: async <T = unknown>(statements: Parameters<TestD1["batch"]>[0]) => {
      batchCalls += 1;
      return base.batch<T>(statements);
    },
  };
  return {
    db,
    queries,
    get batchCalls() {
      return batchCalls;
    },
    writeQueries: () => queries.filter((sql) => /^\s*(insert|update|delete)\b/i.test(sql)),
    reset() {
      queries.length = 0;
      batchCalls = 0;
    },
  };
}

afterEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockCookieValue = undefined;
  deletedCookies.length = 0;
  responseHeaders.length = 0;
});

describe("S2B-4: unauthenticated signOut executes zero D1 writes", () => {
  test("forged 64-hex token does not execute a D1 DELETE batch", async () => {
    const tracker = trackDb();
    await signOut(tracker.db, owner, "a".repeat(64), T0);
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.writeQueries()).toEqual([]);
  });

  test("uppercase 64-hex token executes zero D1 queries", async () => {
    const tracker = trackDb();
    await signOut(tracker.db, owner, "A".repeat(64), T0);
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.queries).toEqual([]);
  });

  test("expired or rotated-secret session token does not execute a D1 DELETE batch", async () => {
    const tracker = trackDb();
    const result = await signIn(tracker.db, owner, good, T0);
    if (!result.ok) throw new Error(result.error);
    tracker.reset();

    await signOut(tracker.db, owner, result.token, T0 + ADMIN_SESSION_SECONDS * 1000 + 1);
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.writeQueries()).toEqual([]);

    await signOut(tracker.db, { ...owner, secret: "rotated-secret-value-0987654321" }, result.token, T0 + 1000);
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.writeQueries()).toEqual([]);
  });

  test("signOutWithCookie skips D1 writes when unauthenticated while still clearing the cookie", async () => {
    const tracker = trackDb();
    mockEnv.DB = tracker.db;
    mockEnv.ADMIN_USERNAME = owner.username;
    mockEnv.ADMIN_SECRET = owner.secret;

    // Uppercase 64-hex invalid cookie: zero D1 queries at all, cookie still cleared.
    mockCookieValue = "A".repeat(64);
    expect(await signOutWithCookie()).toEqual({ ok: true });
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.queries).toEqual([]);
    expect(deletedCookies).toEqual([
      {
        name: ADMIN_SESSION_COOKIE,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: "/",
        },
      },
    ]);

    // Forged lowercase 64-hex cookie: zero D1 write/DELETE queries, cookie still cleared.
    deletedCookies.length = 0;
    tracker.reset();
    mockCookieValue = "b".repeat(64);
    expect(await signOutWithCookie()).toEqual({ ok: true });
    expect(tracker.batchCalls).toBe(0);
    expect(tracker.writeQueries()).toEqual([]);
    expect(deletedCookies).toEqual([
      {
        name: ADMIN_SESSION_COOKIE,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: "/",
        },
      },
    ]);
  });
});

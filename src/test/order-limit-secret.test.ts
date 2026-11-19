import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// env.ts imports cloudflare:workers, which bun:test cannot resolve. The mock only has to exist;
// orderLimitSecret takes the bindings as an argument and does not read this object.
mock.module("cloudflare:workers", () => ({
  env: {},
  waitUntil() {},
}));

const { orderLimitSecret } = await import("@/server/env");

const FALLBACK = "cavara-order-limits-fallback-v1";
const ORDER_SECRET = "x".repeat(32);
const warns: string[] = [];
const originalWarn = console.warn;

beforeEach(() => {
  warns.length = 0;
  console.warn = (message?: unknown) => {
    warns.push(String(message));
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

describe("orderLimitSecret", () => {
  test("uses ORDER_RATE_LIMIT_SECRET when it is long enough", () => {
    expect(orderLimitSecret({ ORDER_RATE_LIMIT_SECRET: `  ${ORDER_SECRET}  ` }, "cavarabd.com")).toBe(ORDER_SECRET);
    expect(warns).toEqual([]);
  });

  test("derives a key from ADMIN_SECRET when the order secret is missing or short", () => {
    const derived = createHmac("sha256", "admin-password").update("cavara-order-limits-v1").digest("hex");
    expect(orderLimitSecret({ ADMIN_SECRET: " admin-password " }, "cavarabd.com")).toBe(derived);
    expect(
      orderLimitSecret({ ORDER_RATE_LIMIT_SECRET: "too-short", ADMIN_SECRET: "admin-password" }, "localhost"),
    ).toBe(derived);
    expect(derived).not.toBe(FALLBACK);
    expect(derived).not.toBe("admin-password");
    expect(warns.some((line) => line.includes("ADMIN_SECRET"))).toBe(true);
  });

  test("uses the public fallback on localhost when neither secret is set, and still does not throw elsewhere", () => {
    expect(orderLimitSecret({}, "localhost:3000")).toBe(FALLBACK);
    expect(orderLimitSecret({}, "127.0.0.1")).toBe(FALLBACK);
    expect(orderLimitSecret({}, "cavarabd.com")).toBe(FALLBACK);
    expect(orderLimitSecret({ ORDER_RATE_LIMIT_SECRET: "   " }, "www.cavarabd.com")).toBe(FALLBACK);
  });
});

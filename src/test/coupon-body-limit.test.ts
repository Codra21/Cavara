import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createServerEntry } from "@tanstack/react-start/server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import type { CouponCheckResult } from "@/domain/coupons";

const workerEnv: Record<string, unknown> = {};

mock.module("cloudflare:workers", () => ({
  env: workerEnv,
  waitUntil() {},
}));

const { checkCouponFn } = await import("@/server/functions/coupons.functions");

async function runCheckCoupon(data: unknown): Promise<CouponCheckResult> {
  let captured: CouponCheckResult | undefined;
  const request = new Request("https://cavarabd.com/_serverFn/checkCoupon", {
    method: "POST",
    headers: {
      host: "cavarabd.com",
      "cf-connecting-ip": "203.0.113.10",
    },
  });
  // Outside the Vite server-fn transform, createServerFn runs the handler as extractedFn and merges its
  // return value onto the middleware context rather than into ctx.result. A test middleware reads it back.
  const captureMiddleware = {
    options: {
      client: async ({ next }: { next: () => Promise<Record<string, unknown>> }) => {
        const res = await next();
        if (typeof res.ok === "boolean") {
          captured = res.ok
            ? ({
                ok: true,
                code: res.code,
                discount: res.discount,
                itemsTotal: res.itemsTotal,
                subtotal: res.subtotal,
              } as CouponCheckResult)
            : ({
                ok: false,
                reason: res.reason,
                message: res.message,
              } as CouponCheckResult);
        }
        return res;
      },
    },
  };
  const entry = createServerEntry({
    fetch: async () => {
      await runWithStartContext(
        {
          getRouter: () => {
            throw new Error("router unused in serverFn test");
          },
          request,
          startOptions: { functionMiddleware: [captureMiddleware] },
          contextAfterGlobalMiddlewares: {},
          handlerType: "serverFn",
        },
        async () => {
          const direct = await checkCouponFn({ data });
          if (!captured && direct && typeof direct === "object" && "ok" in direct) {
            captured = direct as CouponCheckResult;
          }
          return direct;
        },
      );
      return new Response("ok");
    },
  });
  await entry.fetch(request);
  if (!captured) throw new Error("checkCouponFn did not return a CouponCheckResult");
  return captured;
}

describe("checkCouponFn body size cap", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let dbAccessed = 0;
  let turnstileSuccess = true;

  beforeEach(() => {
    fetchCalls = 0;
    dbAccessed = 0;
    turnstileSuccess = true;
    workerEnv.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
    workerEnv.TURNSTILE_MODE = "on";
    Object.defineProperty(workerEnv, "DB", {
      configurable: true,
      enumerable: true,
      get() {
        dbAccessed += 1;
        return {
          prepare() {
            throw new Error("D1 must not be queried");
          },
          batch() {
            throw new Error("D1 must not be queried");
          },
        };
      },
    });
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          success: turnstileSuccess,
          action: "coupon",
          hostname: "cavarabd.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete workerEnv.TURNSTILE_SECRET_KEY;
    delete workerEnv.TURNSTILE_MODE;
    delete workerEnv.DB;
  });

  test("rejects an oversized payload before calling Turnstile or D1", async () => {
    const result = await runCheckCoupon({
      turnstileToken: "valid-token",
      code: "SAVE200",
      items: [{ productId: 1, variant: 0, qty: 1 }],
      padding: "x".repeat(20_000),
    });

    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "That request is too large.",
    });
    expect(fetchCalls).toBe(0);
    expect(dbAccessed).toBe(0);
  });

  test("rejects an unserializable payload before calling Turnstile or D1", async () => {
    const circular: Record<string, unknown> = {
      turnstileToken: "valid-token",
      code: "SAVE200",
    };
    circular.self = circular;

    const result = await runCheckCoupon(circular);

    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "That request could not be read.",
    });
    expect(fetchCalls).toBe(0);
    expect(dbAccessed).toBe(0);
  });

  test("allows a normal-sized payload through to Turnstile", async () => {
    turnstileSuccess = false;
    const result = await runCheckCoupon({
      turnstileToken: "valid-token",
      code: "SAVE200",
      items: [{ productId: 1, variant: 0, qty: 1 }],
    });

    expect(result.ok).toBe(false);
    expect(fetchCalls).toBe(1);
    expect(dbAccessed).toBe(0);
  });
});

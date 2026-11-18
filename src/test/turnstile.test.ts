import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  isLocalHost,
  MAX_TOKEN_LENGTH,
  SITEVERIFY_URL,
  splitTurnstileToken,
  verifyTurnstile,
} from "@/server/turnstile.server";

type FetchCall = { url: string; init: RequestInit };

/** A Siteverify double: records the request and answers with `reply`, or runs it when it is a function that throws. */
function siteverify(reply: object | (() => never), status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (typeof reply === "function") return reply();
    return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ctx = { secret: "real-secret", host: "cavarabd.com", remoteIp: "203.0.113.7" };

describe("verifyTurnstile", () => {
  let warn: ReturnType<typeof spyOn>;
  let error: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
    error = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  test("a valid token for the right action passes, and Siteverify gets secret, token and remoteip", async () => {
    const { calls, fetchImpl } = siteverify({ success: true, action: "order", hostname: "cavarabd.com" });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: true, skipped: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SITEVERIFY_URL);
    expect(calls[0]?.init.method).toBe("POST");
    const form = calls[0]?.init.body as URLSearchParams;
    expect(form.get("secret")).toBe("real-secret");
    expect(form.get("response")).toBe("tok");
    expect(form.get("remoteip")).toBe("203.0.113.7");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a token minted for another action is refused", async () => {
    const { fetchImpl } = siteverify({ success: true, action: "coupon" });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: false, reason: "wrong_action" });
  });

  test("a token with no action is refused when the secret is a real one", async () => {
    const { fetchImpl } = siteverify({ success: true });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: false, reason: "wrong_action" });
  });

  test("a token solved on another host is refused, and the host comparison ignores case and port", async () => {
    const other = siteverify({ success: true, action: "order", hostname: "evil.example" });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl: other.fetchImpl })).toEqual({
      ok: false,
      reason: "wrong_host",
    });
    const none = siteverify({ success: true, action: "order" });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl: none.fetchImpl })).toEqual({
      ok: false,
      reason: "wrong_host",
    });
    const same = siteverify({ success: true, action: "order", hostname: "CavaraBD.com" });
    expect(
      await verifyTurnstile("tok", "order", { ...ctx, host: "cavarabd.com:443", fetchImpl: same.fetchImpl }),
    ).toEqual({
      ok: true,
      skipped: false,
    });
  });

  test("Cloudflare's dummy secret never echoes an action, so the action check is left out for it", async () => {
    const { fetchImpl } = siteverify({
      success: true,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: true, skipped: false });
  });

  test("a failed verification is refused", async () => {
    const { fetchImpl } = siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: false, reason: "rejected" });
  });

  test("a network error fails closed", async () => {
    const { fetchImpl } = siteverify(() => {
      throw new TypeError("network down");
    });
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl })).toEqual({ ok: false, reason: "unreachable" });
  });

  test("a Siteverify outage (5xx) and a body that is not JSON fail closed", async () => {
    const down = siteverify({}, 502);
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl: down.fetchImpl })).toEqual({
      ok: false,
      reason: "unreachable",
    });
    const junk = (async () => new Response("<html>")) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl: junk })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  test("a missing or oversize token is refused without calling Siteverify", async () => {
    const { calls, fetchImpl } = siteverify({ success: true, action: "order" });
    for (const token of ["", "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
      expect(await verifyTurnstile(token, "order", { ...ctx, fetchImpl })).toEqual({
        ok: false,
        reason: "missing_token",
      });
    }
    expect(calls).toHaveLength(0);
  });

  test("no secret: skipped on localhost with a warning, refused on any other host", async () => {
    const { calls, fetchImpl } = siteverify({ success: true });
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(await verifyTurnstile("", "order", { host, secret: undefined, fetchImpl })).toEqual({
        ok: true,
        skipped: true,
      });
    }
    expect(warn).toHaveBeenCalled();
    for (const host of ["cavarabd.com", "cavara-web-dev.example.workers.dev", "", "localhost.evil.com"]) {
      expect(await verifyTurnstile("tok", "order", { host, secret: "  ", fetchImpl })).toEqual({
        ok: false,
        reason: "not_configured",
      });
    }
    expect(calls).toHaveLength(0);
  });

  test("a secret that is set is used on localhost too", async () => {
    const { calls, fetchImpl } = siteverify({ success: false });
    const outcome = await verifyTurnstile("tok", "order", { secret: "s", host: "localhost:3000", fetchImpl });
    expect(outcome).toEqual({ ok: false, reason: "rejected" });
    expect(calls).toHaveLength(1);
  });

  test("remoteip is left out when the client address is unknown", async () => {
    for (const remoteIp of [undefined, "", "local"]) {
      const { calls, fetchImpl } = siteverify({ success: true, action: "coupon" });
      await verifyTurnstile("tok", "coupon", { ...ctx, remoteIp, fetchImpl });
      expect((calls[0]?.init.body as URLSearchParams).has("remoteip")).toBe(false);
    }
  });

  test("a hung Siteverify is cut off by the timeout", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      })) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "order", { ...ctx, fetchImpl, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("splitTurnstileToken", () => {
  test("separates the token from the body, which keeps every other key", () => {
    expect(splitTurnstileToken({ turnstileToken: "abc", name: "A", items: [1] })).toEqual({
      token: "abc",
      rest: { name: "A", items: [1] },
    });
  });

  test("a missing or non-string token is empty", () => {
    expect(splitTurnstileToken({ name: "A" })).toEqual({ token: "", rest: { name: "A" } });
    expect(splitTurnstileToken({ turnstileToken: 5 })).toEqual({ token: "", rest: {} });
  });

  test("a body that is not an object passes through with no token", () => {
    expect(splitTurnstileToken(null)).toEqual({ token: "", rest: null });
    expect(splitTurnstileToken("x")).toEqual({ token: "", rest: "x" });
    expect(splitTurnstileToken([1])).toEqual({ token: "", rest: [1] });
  });
});

describe("isLocalHost", () => {
  test("recognises local development hosts only", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("LOCALHOST:3000")).toBe(true);
    expect(isLocalHost("127.0.0.1:8787")).toBe(true);
    expect(isLocalHost("cavarabd.com")).toBe(false);
    expect(isLocalHost("localhost.cavarabd.com")).toBe(false);
  });
});

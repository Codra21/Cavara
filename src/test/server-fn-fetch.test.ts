import { describe, expect, test } from "bun:test";
import type { CustomFetch } from "@tanstack/react-start";
import { csrfMiddleware, startInstance } from "@/start";
import { isChallenged, withChallengeRecovery } from "@/lib/server-fn-fetch";

const challenged = () =>
  new Response("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } });
const ok = (body = "{}") => new Response(body, { status: 200 });

/** A fetch double that answers from a queue and records what it was asked. */
function queue(...responses: Response[]) {
  const calls: { input: unknown; init: RequestInit | undefined }[] = [];
  const base = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  }) as unknown as CustomFetch;
  return { base, calls };
}

describe("withChallengeRecovery", () => {
  test("an ordinary response passes through without recovering", async () => {
    const { base, calls } = queue(ok("a"));
    let recovered = 0;
    const wrapped = withChallengeRecovery(base, async () => void (recovered += 1));
    expect(await (await wrapped("/_serverFn/x", { method: "POST", body: "{}" })).text()).toBe("a");
    expect(calls).toHaveLength(1);
    expect(recovered).toBe(0);
  });

  test("a challenged response waits for recovery, then retries once with the same request", async () => {
    const { base, calls } = queue(challenged(), ok("second"));
    const order: string[] = [];
    const wrapped = withChallengeRecovery(base, async () => {
      order.push("recover");
    });
    const init = { method: "POST", body: '{"a":1}' };
    const response = await wrapped("/_serverFn/x", init);
    expect(await response.text()).toBe("second");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toBe("/_serverFn/x");
    expect(calls[1]?.init).toBe(init);
    expect(order).toEqual(["recover"]);
  });

  test("a second challenge is returned, not retried again", async () => {
    const { base, calls } = queue(challenged(), challenged());
    const wrapped = withChallengeRecovery(base, async () => {});
    const response = await wrapped("/_serverFn/x", { method: "POST", body: "{}" });
    expect(isChallenged(response)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("a recovery that fails still retries once", async () => {
    const { base, calls } = queue(challenged(), ok());
    const wrapped = withChallengeRecovery(base, async () => {
      throw new Error("widget blocked");
    });
    expect((await wrapped("/_serverFn/x", { method: "POST", body: "{}" })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("other 403s (a CSRF refusal, say) are not treated as a challenge", async () => {
    const { base, calls } = queue(new Response("Forbidden", { status: 403 }));
    const wrapped = withChallengeRecovery(base, async () => {
      throw new Error("must not run");
    });
    expect((await wrapped("/_serverFn/x", { method: "POST", body: "{}" })).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  test("a streamed body cannot be sent twice, so the challenge is returned as it is", async () => {
    const { base, calls } = queue(challenged());
    const wrapped = withChallengeRecovery(base, async () => {
      throw new Error("must not run");
    });
    const body = new ReadableStream();
    const response = await wrapped("/_serverFn/x", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(isChallenged(response)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a Request input is cloned for the first send, so the retry can still use it", async () => {
    const { base, calls } = queue(challenged(), ok());
    const wrapped = withChallengeRecovery(base, async () => {});
    const request = new Request("https://cavarabd.com/_serverFn/x", { method: "POST", body: "{}" });
    await wrapped(request);
    expect(calls[0]?.input).not.toBe(request);
    expect(calls[1]?.input).toBe(request);
  });
});

describe("src/start.ts keeps CSRF protection for server functions", () => {
  // Without src/start.ts Start falls back to its default CSRF middleware; with it, only what is listed here runs.
  const run = async (headers: Record<string, string>, handlerType = "serverFn") => {
    let continued = false;
    const middleware = csrfMiddleware as unknown as { options: { server: (ctx: unknown) => unknown } };
    const result = await middleware.options.server({
      request: new Request("https://cavarabd.com/_serverFn/abc", { method: "POST", headers, body: "{}" }),
      handlerType,
      next: () => {
        continued = true;
        return "next";
      },
    });
    return { continued, result };
  };

  test("the start options register the CSRF middleware and the recovering fetch", async () => {
    const options = await startInstance.getOptions();
    expect(options.requestMiddleware).toEqual([csrfMiddleware]);
    expect(typeof options.serverFns?.fetch).toBe("function");
  });

  test("a cross-site POST to a server function is rejected with 403", async () => {
    for (const headers of <Record<string, string>[]>[
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { Origin: "https://evil.example" },
      { Referer: "https://evil.example/page" },
    ]) {
      const { continued, result } = await run(headers);
      expect(continued).toBe(false);
      expect((result as Response).status).toBe(403);
    }
  });

  test("a request with no origin metadata at all is rejected too", async () => {
    const { continued, result } = await run({});
    expect(continued).toBe(false);
    expect((result as Response).status).toBe(403);
  });

  test("same-origin calls go through", async () => {
    expect((await run({ "Sec-Fetch-Site": "same-origin" })).continued).toBe(true);
    expect((await run({ Origin: "https://cavarabd.com" })).continued).toBe(true);
  });

  test("the filter leaves page requests alone", async () => {
    expect((await run({ "Sec-Fetch-Site": "cross-site" }, "router")).continued).toBe(true);
  });
});

// The fetch every server-function call uses (registered in src/start.ts as `serverFns.fetch`; Start applies it on
// the client only). The zone's WAF rule answers a call without a valid `cf_clearance` cookie with a Managed Challenge
// and the header `cf-mitigated: challenge` (developers.cloudflare.com/cloudflare-challenges/challenge-types/
// challenge-pages/detect-response/). The page cannot solve that response, so it re-runs the Turnstile widget to renew
// the cookie and sends the call once more. The cookie lapses after the zone's Challenge Passage time (30 minutes by
// default), which is how a tab left open overnight ends up here.
import type { CustomFetch } from "@tanstack/react-start";
import { ensureClearance } from "@/lib/turnstile";

export function isChallenged(response: Response): boolean {
  return response.headers.get("cf-mitigated") === "challenge";
}

/** A body a second send can reuse: none, or a string, bytes, form or blob (not a stream). */
function canReplay(init: Parameters<CustomFetch>[1]): boolean {
  const body = init?.body;
  return !(typeof ReadableStream !== "undefined" && body instanceof ReadableStream);
}

/**
 * Wraps `base`: a response marked `cf-mitigated: challenge` waits for `recover()` and is retried once. A second
 * challenged response is returned as it is. With a streamed body, which cannot be sent twice, the first response is
 * returned.
 */
export function withChallengeRecovery(base: CustomFetch, recover: () => Promise<void>): CustomFetch {
  return async (input, init) => {
    if ((input instanceof Request && input.bodyUsed) || !canReplay(init)) return base(input, init);
    // A Request is consumed by sending it, so the first send uses a copy.
    const first = await base(input instanceof Request ? input.clone() : input, init);
    if (!isChallenged(first)) return first;
    void first.body?.cancel();
    await recover().catch(() => undefined);
    return base(input, init);
  };
}

export const serverFnFetch: CustomFetch = withChallengeRecovery(
  (input, init) => fetch(input, init),
  () => ensureClearance({ force: true }),
);

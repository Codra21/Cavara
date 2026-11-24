// Server side of Cloudflare Turnstile: Siteverify for the checkout and the coupon check. Pure module (no
// cloudflare:workers import, fetch injectable), so bun:test runs it. The secret comes from TURNSTILE_SECRET_KEY.
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// A token is single use and valid for 300 s, at most 2048 characters. Siteverify takes form data or JSON.

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

import type { TurnstileAction } from "@/domain/turnstile";

export type { TurnstileAction };

export const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 5_000;

export type TurnstileOutcome =
  | { ok: true; skipped: boolean }
  | {
      ok: false;
      reason: "not_configured" | "missing_token" | "rejected" | "wrong_action" | "wrong_host" | "unreachable";
    };

export interface TurnstileContext {
  /** TURNSTILE_SECRET_KEY. Unset or blank: verification is skipped on localhost and refused everywhere else. */
  secret?: string | undefined;
  /** Host header of the request: recognises local development, and a real token must have been solved on it. */
  host: string;
  /** cf-connecting-ip, sent to Siteverify as remoteip. Blank or the local stand-in is left out. */
  remoteIp?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** False (TURNSTILE_MODE "off") passes every request without calling Siteverify. */
  enforce?: boolean;
}

interface SiteverifyBody {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

/** Lower-case host name without port or IPv6 brackets. */
export function hostName(host: string): string {
  const trimmed = host.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  const inner = bracketed?.[1];
  if (inner) return inner;
  const firstColon = trimmed.indexOf(":");
  if (firstColon !== -1 && firstColon === trimmed.lastIndexOf(":")) {
    return trimmed.slice(0, firstColon);
  }
  return trimmed;
}

export function isLocalHost(host: string): boolean {
  const name = hostName(host);
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/**
 * Checks a Turnstile token with Siteverify. Fails closed: a missing secret off localhost, a missing or oversize token,
 * a rejected token, another action's token and an unreachable Siteverify all refuse. Nothing here touches D1.
 */
export async function verifyTurnstile(
  token: string,
  expectedAction: TurnstileAction,
  context: TurnstileContext,
): Promise<TurnstileOutcome> {
  if (context.enforce === false) return { ok: true, skipped: true };
  const secret = context.secret?.trim();
  if (!secret) {
    if (isLocalHost(context.host)) {
      console.warn("TURNSTILE_SECRET_KEY is not set; skipping the Turnstile check on localhost");
      return { ok: true, skipped: true };
    }
    console.error("TURNSTILE_SECRET_KEY is not set; refusing the request");
    return { ok: false, reason: "not_configured" };
  }
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "missing_token" };

  const form = new URLSearchParams({ secret, response: token });
  const ip = context.remoteIp?.trim();
  if (ip && ip !== "local") form.set("remoteip", ip);

  let body: SiteverifyBody;
  try {
    const response = await (context.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(context.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Siteverify answered ${response.status}`);
    body = (await response.json()) as SiteverifyBody;
  } catch (error) {
    console.error("Turnstile Siteverify failed", error);
    return { ok: false, reason: "unreachable" };
  }

  if (body.success !== true) {
    console.warn("Turnstile token rejected", body["error-codes"] ?? []);
    return { ok: false, reason: "rejected" };
  }
  // Cloudflare's dummy secrets never echo the action or a real hostname back (they flag result_with_testing_key
  // instead), so both can only be checked with a real secret.
  if (!body.metadata?.result_with_testing_key) {
    if (body.action !== expectedAction) {
      console.warn("Turnstile token has the wrong action", body.action);
      return { ok: false, reason: "wrong_action" };
    }
    // The token must have been solved on the host this request came to (the widget's hostname list allows
    // cavarabd.com and www.cavarabd.com). Spin guide: developers.cloudflare.com/turnstile/spin/prompt.md
    if (!body.hostname || hostName(body.hostname) !== hostName(context.host)) {
      console.warn("Turnstile token was solved on another host", body.hostname);
      return { ok: false, reason: "wrong_host" };
    }
  }
  return { ok: true, skipped: false };
}

/**
 * Pulls `turnstileToken` out of a server function's raw body. The rest goes on to the service unchanged, because the
 * checkout schema is strict and would refuse the extra key.
 */
export function splitTurnstileToken(data: unknown): { token: string; rest: unknown } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { token: "", rest: data };
  const { turnstileToken, ...rest } = data as Record<string, unknown>;
  return { token: typeof turnstileToken === "string" ? turnstileToken : "", rest };
}

/** Shopper-facing text for a refused check. Same for every reason, so a bot learns nothing from it. */
export const TURNSTILE_REFUSAL_MESSAGE =
  "We couldn't confirm this request came from you. Please reload the page and try again, or message us on WhatsApp.";

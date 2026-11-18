// Client side of Cloudflare Turnstile. Two jobs:
// 1. Pre-clearance. One widget (rendered after hydration by TurnstilePanel) earns the `cf_clearance` cookie that lets
//    server-function calls past the zone's WAF Managed Challenge rule. ensureClearance() waits for it and, with
//    `force`, runs the widget again after a call came back challenged (the cookie lasts the zone's Challenge Passage
//    time, 30 minutes by default).
// 2. Per-action tokens. getTurnstileToken(action) renders a short-lived widget with that action, resolves with its
//    single-use token and removes it. The server checks the token with Siteverify (src/server/turnstile.server.ts).
// Both use appearance "interaction-only": the widget stays invisible unless the visitor must act, and then the
// fixed panel becomes visible. No site key (VITE_TURNSTILE_SITE_KEY) means nothing runs and tokens are "".
// SSR-safe: every browser access sits behind the `window` check in siteKey().
// Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ (explicit rendering, options),
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/,
// https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/ (pre-clearance).

import type { TurnstileAction } from "@/domain/turnstile";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const PANEL_ID = "turnstile-panel";
const SLOT_ID = "turnstile-slot";
/** How long a caller waits for a pass. A visitor who has to click gets this long; after it the call goes on and the
 * server (or the WAF) decides. */
const CLEARANCE_WAIT_MS = 45_000;
const TOKEN_WAIT_MS = 60_000;

interface RenderOptions {
  sitekey: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => void;
  "expired-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
}

interface TurnstileApi {
  render(container: string, options: RenderOptions): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function siteKey(): string {
  if (typeof window === "undefined") return "";
  const key: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === "string" ? key.trim() : "";
}

export function isTurnstileEnabled(): boolean {
  return siteKey() !== "";
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadApi(): Promise<TurnstileApi | null> {
  if (!isTurnstileEnabled()) return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi | null>((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      // An ad blocker or a network failure. Forget it so a later call can try again.
      script.remove();
      scriptPromise = null;
      resolve(null);
    };
    document.head.append(script);
  });
  return scriptPromise;
}

// ---------------------------------------------------------------------------------------------------------------
// The panel: hidden until a widget needs the visitor, then a small fixed box (styled in site.css).

let interactiveWidgets = 0;

function showPanel(active: boolean) {
  document.getElementById(PANEL_ID)?.toggleAttribute("data-active", active);
}

/** Callbacks that raise and lower the panel for one widget, plus a release for when the widget is removed. */
function interactiveHooks() {
  let open = false;
  const set = (next: boolean) => {
    if (open === next) return;
    open = next;
    interactiveWidgets = Math.max(0, interactiveWidgets + (next ? 1 : -1));
    showPanel(interactiveWidgets > 0);
  };
  return {
    before: () => set(true),
    after: () => set(false),
    release: () => set(false),
  };
}

let slotCounter = 0;

/** A fresh container for one widget, inside the panel's slot (or the body when the panel is not mounted). */
function createSlot(): HTMLElement {
  const element = document.createElement("div");
  element.id = `${SLOT_ID}-${(slotCounter += 1)}`;
  (document.getElementById(SLOT_ID) ?? document.body).append(element);
  return element;
}

// ---------------------------------------------------------------------------------------------------------------
// Pre-clearance

interface Clearance {
  widgetId: string | null;
  element: HTMLElement | null;
  ready: boolean;
  settled: boolean;
  round: Promise<void>;
  settle: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  hooks: ReturnType<typeof interactiveHooks>;
  disposed: boolean;
}

let clearance: Clearance | null = null;

function newRound(state: Clearance) {
  clearTimeout(state.timer);
  state.settled = false;
  state.round = new Promise<void>((resolve) => {
    state.settle = () => {
      state.settled = true;
      clearTimeout(state.timer);
      resolve();
    };
  });
  state.timer = setTimeout(() => state.settle(), CLEARANCE_WAIT_MS);
}

function disposeClearance(state: Clearance) {
  state.disposed = true;
  state.settle();
  state.hooks.release();
  if (state.widgetId) window.turnstile?.remove(state.widgetId);
  state.element?.remove();
}

function startClearance(): Clearance {
  const state = {
    widgetId: null,
    element: null,
    ready: false,
    hooks: interactiveHooks(),
    disposed: false,
    timer: undefined,
  } as unknown as Clearance;
  newRound(state);
  clearance = state;
  void loadApi().then((api) => {
    if (!api || state.disposed) {
      state.settle();
      return;
    }
    state.element = createSlot();
    state.widgetId =
      api.render(`#${state.element.id}`, {
        sitekey: siteKey(),
        appearance: "interaction-only",
        callback: () => {
          state.ready = true;
          state.settle();
        },
        // The widget retries by itself. The wait is capped, so a failure never blocks a caller for good.
        "error-callback": () => {
          state.ready = false;
        },
        // The token expires after 300 s; the widget refreshes itself, and callers wait for the new pass.
        "expired-callback": () => {
          state.ready = false;
          if (state.settled) newRound(state);
        },
        "before-interactive-callback": state.hooks.before,
        "after-interactive-callback": state.hooks.after,
      }) ?? null;
  });
  return state;
}

/**
 * Resolves once this browser holds a Turnstile pass (the `cf_clearance` cookie), or after a cap when it cannot get
 * one, so callers never hang. Concurrent calls share one round. `force` runs the widget again because a request was
 * challenged although the widget believed it had passed; a round already in progress is joined, not restarted.
 * Resolves at once when Turnstile is off (no site key) or on the server.
 */
export function ensureClearance(options: { force?: boolean } = {}): Promise<void> {
  if (!isTurnstileEnabled()) return Promise.resolve();
  if (clearance && !clearance.settled) return clearance.round;
  if (clearance?.ready && !options.force) return Promise.resolve();
  if (clearance) disposeClearance(clearance);
  return startClearance().round;
}

/** Starts the pre-clearance widget. Called once after hydration; safe to call again. */
export function startTurnstile(): void {
  void ensureClearance();
}

// ---------------------------------------------------------------------------------------------------------------
// Per-action tokens

/**
 * A fresh single-use token for `action` ("" when Turnstile is off). Call it right before the server function, because
 * a token is good for one Siteverify call and 300 seconds. Rejects when the widget cannot run (script blocked,
 * challenge failed, no answer in a minute), so the caller can show an error and let the shopper try again.
 */
export async function getTurnstileToken(action: TurnstileAction): Promise<string> {
  if (!isTurnstileEnabled()) return "";
  const api = await loadApi();
  if (!api) throw new Error("Turnstile could not be loaded");
  return new Promise<string>((resolve, reject) => {
    const element = createSlot();
    const hooks = interactiveHooks();
    let widgetId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      hooks.release();
      if (widgetId) api.remove(widgetId);
      element.remove();
      settle();
    };
    timer = setTimeout(() => finish(() => reject(new Error("Turnstile timed out"))), TOKEN_WAIT_MS);
    widgetId =
      api.render(`#${element.id}`, {
        sitekey: siteKey(),
        action,
        appearance: "interaction-only",
        callback: (token) => finish(() => resolve(token)),
        "error-callback": (code) => finish(() => reject(new Error(`Turnstile failed (${code ?? "unknown"})`))),
        "before-interactive-callback": hooks.before,
        "after-interactive-callback": hooks.after,
      }) ?? null;
    if (!widgetId) finish(() => reject(new Error("Turnstile could not start")));
  });
}

/** Test hook: forget every widget and the loaded script state. */
export function resetTurnstileForTests(): void {
  if (clearance) disposeClearance(clearance);
  clearance = null;
  scriptPromise = null;
  interactiveWidgets = 0;
}

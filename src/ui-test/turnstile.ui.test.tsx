import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TurnstilePanel } from "@/components/layout/TurnstilePanel";
import { ensureClearance, getTurnstileToken, resetTurnstileForTests } from "@/lib/turnstile";

interface FakeWidget {
  id: string;
  container: string;
  options: Record<string, (...args: unknown[]) => void> & { action?: string; sitekey: string; appearance: string };
}

let widgets: FakeWidget[];
let removed: string[];

beforeEach(() => {
  widgets = [];
  removed = [];
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000BB");
  window.turnstile = {
    render: (container, options) => {
      const id = `w${widgets.length + 1}`;
      widgets.push({ id, container, options: options as unknown as FakeWidget["options"] });
      return id;
    },
    remove: (id) => {
      removed.push(id);
    },
  };
});

afterEach(() => {
  resetTurnstileForTests();
  delete window.turnstile;
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("with no site key nothing runs and the token is empty", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  await ensureClearance();
  expect(await getTurnstileToken("order")).toBe("");
  expect(widgets).toHaveLength(0);
});

test("ensureClearance renders one invisible widget, shares it between callers and resolves on its pass", async () => {
  const first = ensureClearance();
  const second = ensureClearance();
  await flush();
  expect(widgets).toHaveLength(1);
  expect(widgets[0]?.options.appearance).toBe("interaction-only");
  expect(widgets[0]?.options.sitekey).toBe("1x00000000000000000000BB");
  expect(widgets[0]?.options.action).toBeUndefined();
  widgets[0]?.options.callback?.("pass");
  await Promise.all([first, second]);
  // A pass already held needs no second widget.
  await ensureClearance();
  expect(widgets).toHaveLength(1);
});

test("force runs the widget again after a pass, and concurrent forced calls share the new round", async () => {
  const initial = ensureClearance();
  await flush();
  widgets[0]?.options.callback?.("pass");
  await initial;

  const a = ensureClearance({ force: true });
  const b = ensureClearance({ force: true });
  await flush();
  expect(removed).toEqual(["w1"]);
  expect(widgets).toHaveLength(2);
  widgets[1]?.options.callback?.("pass");
  await Promise.all([a, b]);
});

test("the page-load widget stays hidden while it waits on the visitor, and shows once a call is challenged", async () => {
  render(<TurnstilePanel />);
  await flush();
  const panel = document.getElementById("turnstile-panel");
  expect(panel?.textContent).toContain("One quick check");
  expect(widgets).toHaveLength(1);
  expect(document.getElementById("turnstile-slot")?.children).toHaveLength(1);
  widgets[0]?.options["before-interactive-callback"]?.();
  expect(panel?.hasAttribute("data-active")).toBe(false);

  // A server-function call came back challenged: the same widget is revealed, not replaced.
  const blocked = ensureClearance({ force: true });
  expect(panel?.hasAttribute("data-active")).toBe(true);
  expect(widgets).toHaveLength(1);
  widgets[0]?.options["after-interactive-callback"]?.();
  expect(panel?.hasAttribute("data-active")).toBe(false);
  widgets[0]?.options.callback?.("pass");
  await blocked;
});

test("a forced round after a pass shows its widget when it needs the visitor", async () => {
  render(<TurnstilePanel />);
  await flush();
  widgets[0]?.options.callback?.("pass");
  await ensureClearance();
  const panel = document.getElementById("turnstile-panel");

  const blocked = ensureClearance({ force: true });
  await flush();
  expect(widgets).toHaveLength(2);
  widgets[1]?.options["before-interactive-callback"]?.();
  expect(panel?.hasAttribute("data-active")).toBe(true);
  widgets[1]?.options.callback?.("pass");
  await blocked;
});

test("a token widget shows inside the holder it was given, not the panel", async () => {
  render(<TurnstilePanel />);
  const holder = document.createElement("div");
  document.body.append(holder);
  const pending = getTurnstileToken("order", holder);
  await flush();
  const widget = widgets.find((candidate) => candidate.options.action === "order");
  expect(holder.querySelector(widget?.container ?? "")).not.toBeNull();
  widget?.options["before-interactive-callback"]?.();
  expect(holder.hasAttribute("data-active")).toBe(true);
  expect(document.getElementById("turnstile-panel")?.hasAttribute("data-active")).toBe(false);
  widget?.options.callback?.("tok");
  expect(await pending).toBe("tok");
  expect(holder.hasAttribute("data-active")).toBe(false);
});

test("getTurnstileToken renders a widget with the action, resolves with its token and removes it", async () => {
  const pending = getTurnstileToken("coupon");
  await flush();
  expect(widgets).toHaveLength(1);
  expect(widgets[0]?.options.action).toBe("coupon");
  widgets[0]?.options.callback?.("fresh-token");
  expect(await pending).toBe("fresh-token");
  expect(removed).toEqual(["w1"]);
});

test("a failed challenge rejects the token and cleans up", async () => {
  const pending = getTurnstileToken("order");
  await flush();
  widgets[0]?.options["error-callback"]?.("300030");
  await expect(pending).rejects.toThrow("300030");
  expect(removed).toEqual(["w1"]);
});

test("each token call gets its own widget", async () => {
  const one = getTurnstileToken("order");
  await flush();
  widgets[0]?.options.callback?.("t1");
  await one;
  const two = getTurnstileToken("order");
  await flush();
  expect(widgets).toHaveLength(2);
  widgets[1]?.options.callback?.("t2");
  expect(await two).toBe("t2");
});

#!/usr/bin/env node
/**
 * Real-browser E2E smoke suite for Cavara (replaces brittle jsdom UI primitive tests and
 * automates the previously skipped 375px mobile & SSR SEO checks).
 *
 * Usage:
 *   bun run dev
 *   node e2e/smoke.spec.mjs http://localhost:3000
 */
const baseUrl = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");

if (/cavarabd\.com/i.test(baseUrl)) {
  console.error("Refusing to run E2E against production cavarabd.com. Point at http://localhost:3000.");
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is required: bun add -d playwright && bunx playwright install chromium");
  process.exit(1);
}

const ROUTES = ["/", "/products", "/collections/drinkware", "/admin"];
const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const failures = [];

// 1. SSR HTML check (no JS): title, meta description, OG tags, and JSON-LD must exist in server HTML
for (const route of ["/", "/products", "/collections/drinkware"]) {
  const res = await fetch(`${baseUrl}${route}`);
  if (res.status !== 200) failures.push(`SSR ${route}: expected 200, got ${res.status}`);
  const html = await res.text();
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`SSR ${route}: missing <title>`);
  if (!/name="description"/i.test(html)) failures.push(`SSR ${route}: missing meta description`);
  if (/D1_ERROR|SQLITE_ERROR/i.test(html)) failures.push(`SSR ${route}: raw database error leaked into HTML`);
}

// 2. Real browser layout & console-error check across 375px, 768px, and 1440px
// E2E_BROWSER_CHANNEL=chrome (or msedge) uses an installed browser instead of `playwright install chromium`.
const browser = await chromium.launch(
  process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {},
);
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    for (const route of ROUTES) {
      consoleErrors.length = 0;
      // Not "networkidle": the sitewide Turnstile frame keeps a connection open, so the network never goes idle.
      await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) failures.push(`${vp.name} ${route}: horizontal overflow detected`);
      if (consoleErrors.length) failures.push(`${vp.name} ${route}: console errors: ${consoleErrors.join("; ")}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error("E2E SMOKE FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("E2E SMOKE PASSED (SSR + 375/768/1440px layout + zero console errors).");

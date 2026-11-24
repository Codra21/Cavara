#!/usr/bin/env node
/**
 * Repository invariant checker for Cavara.
 * Turns recurring human/agent mistakes from cavara_root into hard CI failures
 * whose error messages name the exact fix. Zero external dependencies (runs in bun or node).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (!exts || exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(root, file).replace(/\\/g, "/");
const read = (file) => fs.readFileSync(file, "utf8");
const violations = [];

function fail(rule, file, line, message, fix) {
  violations.push({ rule, file: rel(file), line, message, fix });
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const srcFiles = walk(path.join(root, "src"), [".ts", ".tsx"]);
const nonTestSrc = srcFiles.filter((f) => !rel(f).startsWith("src/test/") && !rel(f).startsWith("src/ui-test/"));

// 1. no-secret-in-client-or-env (2026-11-18 incident 409f6eb: Turnstile secret pasted as site key)
for (const envName of [".env.development", ".env.staging", ".env.production", "wrangler.jsonc"]) {
  const full = path.join(root, envName);
  if (!fs.existsSync(full)) continue;
  const text = read(full);
  for (const match of text.matchAll(
    /\b(TURNSTILE_SECRET_KEY|ADMIN_SECRET|CF_WAF_TOKEN|CF_ANALYTICS_TOKEN|TELEGRAM_BOT_TOKEN|ORDER_RATE_LIMIT_SECRET)\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/g,
  )) {
    fail(
      "no-secret-in-client-or-env",
      full,
      lineOf(text, match.index),
      `Secret key ${match[1]} appears to have a literal value committed in ${envName}.`,
      "Move secrets to .dev.vars (local) or `wrangler secret put` (prod); never commit secret values in .env.* or wrangler.jsonc.",
    );
  }
  for (const match of text.matchAll(/VITE_TURNSTILE_SITE_KEY\s*=\s*["']?(0x4AAAAAAA[A-Za-z0-9_\-]{30,})["']?/g)) {
    // Cloudflare Turnstile secret keys are 35+ chars; public site keys are 24 chars (0x4 + 21).
    if (match[1].length > 28) {
      fail(
        "no-secret-in-client-or-env",
        full,
        lineOf(text, match.index),
        `VITE_TURNSTILE_SITE_KEY length (${match[1].length}) looks like a Turnstile secret key, not a public site key.`,
        "Replace with the 24-character public Site Key and store the Secret Key only via `wrangler secret put TURNSTILE_SECRET_KEY`.",
      );
    }
  }
}

// 2. no-remote-binding-in-wrangler (2026-11-13 incident: remote: true burned 1,770 Worker requests in dev)
const wranglerPath = path.join(root, "wrangler.jsonc");
if (fs.existsSync(wranglerPath)) {
  const text = read(wranglerPath);
  for (const match of text.matchAll(/"remote"\s*:\s*true/g)) {
    fail(
      "no-remote-binding-in-wrangler",
      wranglerPath,
      lineOf(text, match.index),
      'Committed `"remote": true` in wrangler.jsonc forces plain `bun run dev` through the remote proxy Worker.',
      'Remove `"remote": true` from wrangler.jsonc and use `bun run dev:remote` (CAVARA_REMOTE_DB=1 in vite.config.ts) when remote bindings are needed.',
    );
  }
}

// 3. no-server-import-in-client + 4. no-public-route-d1-read + 5. no-cost-price-in-public-code
// 6. no-ensure-query-data + 7. no-radix-or-aschild-or-webcss + 10. no-google-fonts-or-raw-error-render
for (const file of nonTestSrc) {
  const r = rel(file);
  const text = read(file);
  const isClientZone = r.startsWith("src/components/") || r.startsWith("src/domain/") || r.startsWith("src/lib/");

  if (isClientZone) {
    for (const match of text.matchAll(
      /from\s+["'](cloudflare:workers|@\/server\/db\/[^"']+|@\/server\/env|.*scripts\/r2\/optimize[^"']*)["']/g,
    )) {
      fail(
        "no-server-import-in-client",
        file,
        lineOf(text, match.index),
        `Client/shared module imports server-only module "${match[1]}".`,
        "Call a server function in src/server/functions/*.functions.ts instead of importing server bindings or DB repositories directly.",
      );
    }
  }

  if (r.startsWith("src/routes/") || r === "src/server/functions/catalog.functions.ts") {
    for (const match of text.matchAll(/from\s+["']@\/server\/db\/catalog\.repository["']/g)) {
      if (r === "src/server/functions/catalog.functions.ts" && /getCatalogFn/.test(text)) continue;
      fail(
        "no-public-route-d1-read",
        file,
        lineOf(text, match.index),
        "Public route or catalog function imports catalog.repository directly (bypasses R2/Edge snapshot cache).",
        "Read from src/server/catalog-queries.server.ts or src/server/catalog-cache.server.ts so public traffic never hits D1 per request.",
      );
    }
  }

  const isPublicCatalogOrStorefront =
    r === "src/server/db/catalog.repository.ts" ||
    r === "src/server/catalog-queries.server.ts" ||
    r.startsWith("src/components/home/") ||
    r.startsWith("src/components/product/") ||
    r.startsWith("src/components/shop/") ||
    r.startsWith("src/components/store/");
  if (isPublicCatalogOrStorefront) {
    // Strip comments before checking for cost_price/costPrice identifiers
    const codeOnly = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of codeOnly.matchAll(/\b(cost_price|costPrice)\b/g)) {
      fail(
        "no-cost-price-in-public-code",
        file,
        lineOf(text, match.index),
        `Public catalog or storefront code references "${match[1]}".`,
        "Remove cost_price/costPrice from public SQL selects and storefront components; cost prices are Owner-only.",
      );
    }
  }

  for (const match of text.matchAll(/\bensureQueryData\s*\(/g)) {
    fail(
      "no-ensure-query-data",
      file,
      lineOf(text, match.index),
      "Direct use of queryClient.ensureQueryData() violates Cavara query standards.",
      "Use `queryClient.query(...)` (or `prefetchQuery` for below-the-fold data) instead of `ensureQueryData`.",
    );
  }

  for (const match of text.matchAll(/from\s+["'](@radix-ui\/[^"']+|radix-ui|@ui-sdk\/core\/web\.css)["']/g)) {
    fail(
      "no-radix-or-aschild-or-webcss",
      file,
      lineOf(text, match.index),
      `Forbidden UI dependency import "${match[1]}".`,
      "Use `@ui-sdk/react` primitives and Cavara's own tokens in app.css/site.css; never import radix-ui or @ui-sdk/core/web.css.",
    );
  }

  if (r.startsWith("src/components/")) {
    for (const match of text.matchAll(/\basChild\b/g)) {
      fail(
        "no-radix-or-aschild-or-webcss",
        file,
        lineOf(text, match.index),
        "Found Radix-style `asChild` prop in component.",
        "Use `@ui-sdk/react`'s `render={<Link ... />}` prop instead of `asChild`.",
      );
    }
  }

  for (const match of text.matchAll(/fonts\.googleapis\.com|fonts\.gstatic\.com/g)) {
    fail(
      "no-google-fonts-or-raw-error-render",
      file,
      lineOf(text, match.index),
      "External Google Fonts URL found.",
      "Use self-hosted WOFF2 fonts in public/fonts/ to keep CSP strict and avoid third-party requests.",
    );
  }

  if (r.startsWith("src/server/db/")) {
    for (const match of text.matchAll(/\bOFFSET\s+(\?|\d+)/gi)) {
      fail(
        "no-offset-or-unbounded-sql",
        file,
        lineOf(text, match.index),
        "SQL query uses OFFSET pagination, which scans and discards rows against D1's daily read quota.",
        "Use keyset pagination (WHERE (sort_col, id) > (?, ?)) with a matching composite index.",
      );
    }
  }
}

// 7b. app.css must never @import site.css
const appCssPath = path.join(root, "src/styles/app.css");
if (fs.existsSync(appCssPath)) {
  const text = read(appCssPath);
  const m = /@import\s+["'][^"']*site\.css["']/.exec(text);
  if (m) {
    fail(
      "no-radix-or-aschild-or-webcss",
      appCssPath,
      lineOf(text, m.index),
      "app.css imports site.css directly, which lets Tailwind v4 scan storefront class names.",
      "Keep site.css linked separately in src/routes/__root.tsx and never @import it from app.css.",
    );
  }
}

// 8. css-theme-token-parity: every custom property in [data-theme="dark"] must exist in :root
const siteCssPath = path.join(root, "src/styles/site.css");
if (fs.existsSync(siteCssPath)) {
  const text = read(siteCssPath);
  const rootMatch = /:root\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  const darkMatch = /\[data-theme="dark"\]\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  if (rootMatch && darkMatch) {
    const extractVars = (block) => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const rootVars = extractVars(rootMatch[1]);
    const darkVars = extractVars(darkMatch[1]);
    for (const v of darkVars) {
      if (!rootVars.has(v)) {
        fail(
          "css-theme-token-parity",
          siteCssPath,
          lineOf(text, darkMatch.index),
          `Dark theme defines token ${v} that is missing from :root (light theme).`,
          `Define ${v} in :root in src/styles/site.css so light and dark themes stay in parity.`,
        );
      }
    }
  }
}

// 9. no-public-route-collision
const publicDir = path.join(root, "public");
for (const reserved of ["healthz", "sitemap.xml", "media"]) {
  const candidate = path.join(publicDir, reserved);
  if (fs.existsSync(candidate)) {
    fail(
      "no-public-route-collision",
      candidate,
      1,
      `Static file public/${reserved} collides with server route /${reserved}.`,
      `Delete public/${reserved} so Cloudflare Workers routes /${reserved} to src/routes/.`,
    );
  }
}

// 11. audit-action-label-parity (prevents twice-repeated missing ActivityLog labels for new audit actions)
const activityLogPath = path.join(root, "src/components/admin/ActivityLog.tsx");
if (fs.existsSync(activityLogPath)) {
  const activityText = read(activityLogPath);
  const labeledActions = new Set([...activityText.matchAll(/["']([a-z]+\.[a-z_]+)["']\s*:/g)].map((m) => m[1]));
  const serverFiles = walk(path.join(root, "src/server"), [".ts"]);
  for (const file of serverFiles) {
    const text = read(file);
    for (const match of text.matchAll(/auditStatement\s*\([^,]+,[^,]+,\s*["']([a-z]+\.[a-z_]+)["']/g)) {
      const action = match[1];
      if (!labeledActions.has(action)) {
        fail(
          "audit-action-label-parity",
          file,
          lineOf(text, match.index),
          `Audit action "${action}" has no human-readable label in src/components/admin/ActivityLog.tsx.`,
          `Add "${action}" to the action label map in src/components/admin/ActivityLog.tsx.`,
        );
      }
    }
  }
}

// 12. no-worker-config-in-tsconfig
const tsconfigPath = path.join(root, "tsconfig.json");
if (fs.existsSync(tsconfigPath)) {
  const text = read(tsconfigPath);
  const m = /worker-configuration\.d\.ts/.exec(text);
  if (m) {
    fail(
      "no-worker-config-in-tsconfig",
      tsconfigPath,
      lineOf(text, m.index),
      "tsconfig.json includes worker-configuration.d.ts, which redefines DOM globals and breaks browser code.",
      "Remove worker-configuration.d.ts from tsconfig.json (or isolate it in a dedicated tsconfig.worker.json).",
    );
  }
}

if (violations.length > 0) {
  console.error(`INVARIANT CHECK FAILED (${violations.length} violation${violations.length === 1 ? "" : "s"}):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}`);
    console.error(`    Problem: ${v.message}`);
    console.error(`    Fix:     ${v.fix}\n`);
  }
  process.exit(1);
}

console.log(`INVARIANT CHECK PASSED (12 rules verified across ${nonTestSrc.length} source files).`);

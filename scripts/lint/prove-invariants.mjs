#!/usr/bin/env node
/**
 * Mutation proof harness for scripts/lint/check-invariants.mjs.
 * Injects real past Cavara mistakes into an isolated temp copy of the repo and proves
 * each lint rule FAILS on the seeded mistake and PASSES on the clean repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const checker = path.join(repoRoot, "scripts/lint/check-invariants.mjs");

function runChecker(targetDir) {
  try {
    const out = execFileSync(process.execPath, [checker, targetDir], { encoding: "utf8", stdio: "pipe" });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// First prove the clean repo passes
const baseline = runChecker(repoRoot);
if (!baseline.ok) {
  console.error("BASELINE REPO FAILED INVARIANT CHECK:\n" + baseline.out);
  process.exit(1);
}
console.log("PASS [baseline] " + baseline.out.trim());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cavara-lint-proof-"));
fs.cpSync(path.join(repoRoot, "src"), path.join(tmp, "src"), { recursive: true });
fs.cpSync(path.join(repoRoot, "public"), path.join(tmp, "public"), { recursive: true });
for (const f of [".env.production", "wrangler.jsonc", "tsconfig.json"]) {
  if (fs.existsSync(path.join(repoRoot, f))) fs.copyFileSync(path.join(repoRoot, f), path.join(tmp, f));
}

const CASES = [
  {
    name: "Turnstile secret pasted as site key (2026-11-18 incident 409f6eb)",
    rule: "no-secret-in-client-or-env",
    file: ".env.production",
    mutate: (t) => t + "\nVITE_TURNSTILE_SITE_KEY=0x4AAAAAAAbCdEfGhIjKlMnOpQrStUvWxYz123456\n",
  },
  {
    name: "Committed remote: true in wrangler.jsonc (2026-11-13 dev proxy burn)",
    rule: "no-remote-binding-in-wrangler",
    file: "wrangler.jsonc",
    mutate: (t) => t.replace('"binding": "IMAGES",', '"binding": "IMAGES", "remote": true,'),
  },
  {
    name: "Client component imports server DB repository",
    rule: "no-server-import-in-client",
    file: "src/components/home/ProductCard.tsx",
    mutate: (t) => 'import { readActiveZones } from "@/server/db/catalog.repository";\n' + t,
  },
  {
    name: "Public route imports catalog.repository directly (2026-11-06 5.9M D1 read burn)",
    rule: "no-public-route-d1-read",
    file: "src/routes/index.tsx",
    mutate: (t) => 'import { readActiveZones } from "@/server/db/catalog.repository";\n' + t,
  },
  {
    name: "cost_price leaked into public catalog query",
    rule: "no-cost-price-in-public-code",
    file: "src/server/catalog-queries.server.ts",
    mutate: (t) => t + "\nconst leaked = { cost_price: 100 };\n",
  },
  {
    name: "OFFSET pagination added to D1 repository",
    rule: "no-offset-or-unbounded-sql",
    file: "src/server/db/admin-orders.repository.ts",
    mutate: (t) => t + '\nconst badSql = "SELECT id FROM orders LIMIT 20 OFFSET 40";\n',
  },
  {
    name: "ensureQueryData used instead of queryClient.query",
    rule: "no-ensure-query-data",
    file: "src/routes/index.tsx",
    mutate: (t) => t + "\n// test\nvoid (async (qc: any) => qc.ensureQueryData({}));\n",
  },
  {
    name: "Radix asChild prop introduced in admin component",
    rule: "no-radix-or-aschild-or-webcss",
    file: "src/components/admin/AdminSignIn.tsx",
    mutate: (t) => t + "\nconst x = <div asChild />;\n",
  },
  {
    name: "Dark theme token missing from :root light theme",
    rule: "css-theme-token-parity",
    file: "src/styles/site.css",
    mutate: (t) => t.replace('[data-theme="dark"] {', '[data-theme="dark"] {\n    --only-in-dark-bug: #ff0000;'),
  },
  {
    name: "Static public/sitemap.xml collides with server route",
    rule: "no-public-route-collision",
    file: "public/sitemap.xml",
    create: "<urlset/>",
  },
  {
    name: "New audit action missing ActivityLog.tsx label (repeated twice)",
    rule: "audit-action-label-parity",
    file: "src/server/db/admin-orders.repository.ts",
    mutate: (t) => t + '\nconst a = auditStatement(db, actor, "order.unlabeled_test", id, {}, now);\n',
  },
  {
    name: "worker-configuration.d.ts added to tsconfig.json",
    rule: "no-worker-config-in-tsconfig",
    file: "tsconfig.json",
    mutate: (t) => t.replace('"include": [', '"include": ["worker-configuration.d.ts", '),
  },
];

let proved = 0;
try {
  for (const c of CASES) {
    const target = path.join(tmp, c.file);
    const existed = fs.existsSync(target);
    const orig = existed ? fs.readFileSync(target, "utf8") : null;
    if (c.create !== undefined) fs.writeFileSync(target, c.create, "utf8");
    else fs.writeFileSync(target, c.mutate(orig), "utf8");

    const res = runChecker(tmp);
    // Restore immediately
    if (existed) fs.writeFileSync(target, orig, "utf8");
    else fs.rmSync(target, { force: true });

    if (res.ok || !res.out.includes(`[${c.rule}]`)) {
      console.error(`PROOF FAILED for "${c.name}" (expected rule [${c.rule}]):\n${res.out}`);
      process.exit(1);
    }
    proved++;
    console.log(`PROVED [${c.rule}] caught: ${c.name}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nALL ${proved}/${CASES.length} INVARIANT LINT RULES PROVED AGAINST SEEDED PAST MISTAKES.`);

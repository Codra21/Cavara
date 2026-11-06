// Applies pending D1 migrations to cavara-prod with two backups taken first. Used by the deploy workflow on every
// push to main, and by hand (`bun run db:release:prod`). Does nothing when cavara-prod is up to date.
//
//   1. Refuses unless every migration is already applied to cavara-dev (changes are tested on dev first).
//   2. Records the D1 Time Travel bookmark of cavara-prod (instant point-in-time restore, 7 days on Workers Free).
//   3. Exports cavara-prod to a SQL file and stores it in the private R2 bucket cavara-backups
//      (d1/cavara-prod/<time>-before-<migration>.sql, deleted after 90 days by a lifecycle rule).
//   4. Applies the migrations.
//   5. Deletes the public catalogue snapshot in R2, so the shop rebuilds it from the migrated data. Edge copies
//      expire within 5 minutes.
//
// Every step prints the commands to restore, and the summary goes to the GitHub job summary when run in Actions.
// Docs: https://developers.cloudflare.com/d1/reference/time-travel/ and
// https://developers.cloudflare.com/d1/best-practices/import-export-data/
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "../..");
const PROD = ["cavara-prod", "--env", "production"];
const BACKUP_BUCKET = "cavara-backups";
// Must match CATALOG_SNAPSHOT_KEY and the IMAGES bucket in wrangler.jsonc env.production.
const SNAPSHOT_OBJECT = "cavara-images-prod/snapshots/catalog-v1.json";
const summary: string[] = [];

function wrangler(args: string[]) {
  const run = Bun.spawnSync(["bunx", "wrangler", ...args], { cwd: appRoot, stdout: "pipe", stderr: "pipe" });
  return { ok: run.exitCode === 0, out: `${run.stdout.toString()}\n${run.stderr.toString()}` };
}

function fail(message: string): never {
  console.error(`::error::${message}`);
  summary.push(`**Failed:** ${message}`);
  writeSummary();
  process.exit(1);
}

function writeSummary() {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file && summary.length) appendFileSync(file, `## Database release\n\n${summary.join("\n\n")}\n`);
}

/** Names of migrations `wrangler d1 migrations list` reports as not yet applied. */
function pendingMigrations(database: string[]): string[] {
  const { ok, out } = wrangler(["d1", "migrations", "list", ...database, "--remote"]);
  if (!ok) fail(`Could not list migrations for ${database[0]}:\n${out.trim()}`);
  if (out.includes("No migrations to apply")) return [];
  const names = [...new Set(out.match(/\b\d{4}_[\w-]+\.sql\b/g) ?? [])];
  if (!names.length) fail(`Could not read the migration list for ${database[0]}:\n${out.trim()}`);
  return names.sort();
}

/** `--backup-only`: steps 2 and 3 only (bookmark and R2 export), e.g. before a risky manual change. */
const backupOnly = process.argv.includes("--backup-only");

const pending = pendingMigrations(PROD);
if (!pending.length && !backupOnly) {
  console.log("cavara-prod is up to date; no migrations to apply.");
  process.exit(0);
}
if (pending.length) console.log(`cavara-prod has ${pending.length} pending migration(s): ${pending.join(", ")}`);

// 1. Tested on dev first.
if (!backupOnly) {
  const devPending = pendingMigrations(["cavara-dev"]);
  const untested = pending.filter((name) => devPending.includes(name));
  if (untested.length) {
    fail(
      `${untested.join(", ")} not applied to cavara-dev yet. Run 'bun run db:migrate:dev', test on dev, then re-run.`,
    );
  }
}

// 2. Time Travel bookmark (fastest way back).
const info = wrangler(["d1", "time-travel", "info", ...PROD, "--json"]);
let bookmark = "";
try {
  bookmark = (JSON.parse(info.out.slice(info.out.indexOf("{"), info.out.lastIndexOf("}") + 1)) as { bookmark: string })
    .bookmark;
} catch {
  // handled below
}
if (!info.ok || !/^[0-9a-f-]{20,}$/i.test(bookmark))
  fail(`Could not read the Time Travel bookmark:\n${info.out.trim()}`);
const restoreBookmark = `bunx wrangler d1 time-travel restore cavara-prod --env production --bookmark=${bookmark}`;
console.log(`Time Travel bookmark before migrating: ${bookmark}`);
summary.push(`Time Travel bookmark before migrating: \`${bookmark}\`\n\nRestore with:\n\n    ${restoreBookmark}`);

// 3. SQL export stored in R2.
const work = mkdtempSync(join(tmpdir(), "cavara-db-"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const label = backupOnly
  ? process.env.GITHUB_EVENT_NAME === "schedule"
    ? "nightly"
    : "manual"
  : `before-${pending[0]!.replace(/\.sql$/, "")}`;
const key = `d1/cavara-prod/${stamp}-${label}.sql`;
try {
  const file = join(work, "cavara-prod.sql");
  const exported = wrangler(["d1", "export", ...PROD, "--remote", "--output", file]);
  const bytes = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  if (!exported.ok || bytes === 0) fail(`Export of cavara-prod failed; nothing was migrated:\n${exported.out.trim()}`);
  const stored = wrangler([
    "r2",
    "object",
    "put",
    `${BACKUP_BUCKET}/${key}`,
    "--file",
    file,
    "--remote",
    "--content-type",
    "application/sql",
  ]);
  if (!stored.ok) fail(`Could not store the export in R2; nothing was migrated:\n${stored.out.trim()}`);
  console.log(`Exported cavara-prod (${bytes} bytes) to r2://${BACKUP_BUCKET}/${key}`);
  summary.push(
    `SQL export (${bytes} bytes): \`r2://${BACKUP_BUCKET}/${key}\`\n\nDownload with:\n\n    bunx wrangler r2 object get ${BACKUP_BUCKET}/${key} --remote --file cavara-prod.sql`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (backupOnly) {
  writeSummary();
  console.log("Backup finished; nothing was migrated.");
  process.exit(0);
}

// 4. Migrate.
const applied = wrangler(["d1", "migrations", "apply", ...PROD, "--remote"]);
console.log(applied.out.trim());
if (!applied.ok || pendingMigrations(PROD).length) {
  fail(
    `Migrating cavara-prod failed. The new code was not deployed. To return to the state before this run:\n\n    ${restoreBookmark}`,
  );
}
summary.push(`Applied: ${pending.map((name) => `\`${name}\``).join(", ")}`);
writeSummary();
console.log(`Applied ${pending.join(", ")} to cavara-prod.`);

// 5. Drop the catalogue snapshot. A failure here does not undo the migration; the shop would keep serving the
// pre-migration catalogue until the next product save, so it fails the job to get attention.
const dropped = wrangler(["r2", "object", "delete", SNAPSHOT_OBJECT, "--remote"]);
if (!dropped.ok)
  fail(`Migrated, but deleting the catalogue snapshot failed. Run:

    bunx wrangler r2 object delete ${SNAPSHOT_OBJECT} --remote

${dropped.out}`);
console.log("Deleted the catalogue snapshot; the shop rebuilds it from D1 on the next read.");

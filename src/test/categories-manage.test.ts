import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationFiles } from "./helpers/d1";

// Each test spawns the CLI several times; a cold `bun` start on Windows takes over a second.
const CLI_TIMEOUT_MS = 30_000;

const REPO_ROOT = join(import.meta.dir, "../..");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");
const SCRIPT_PATH = join(REPO_ROOT, "scripts/categories/manage.ts");

const tempDirs: string[] = [];

function createTempCategoryDb() {
  const dir = mkdtempSync(join(tmpdir(), "cavara-categories-manage-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "test.sqlite");
  const sqlite = new Database(dbPath);
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles()) {
    sqlite.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  sqlite.run(
    "INSERT INTO categories (id, name, slug, description, image, parent_id, sort, active) VALUES (?, ?, ?, '', '', NULL, 10, 1)",
    ["ceramic-mugs", "Ceramic Mugs", "ceramic-mugs"],
  );
  sqlite.run(
    "INSERT INTO categories (id, name, slug, description, image, parent_id, sort, active) VALUES (?, ?, ?, '', '', NULL, 20, 1)",
    ["mugs", "Mugs", "mugs"],
  );
  sqlite.close();
  return dbPath;
}

function runManage(args: string[]) {
  const proc = Bun.spawnSync(["bun", SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("scripts/categories/manage.ts rename trimmed input handling (C4B-1)", () => {
  test(
    "writes trimmed slug and name to D1 and audit log, and avoids self-redirect on whitespace-only change",
    () => {
      const dbPath = createTempCategoryDb();

      const renamed = runManage([
        "rename",
        "--db",
        dbPath,
        "--id",
        "ceramic-mugs",
        "--slug",
        " handcrafted-mugs ",
        "--name",
        " Handcrafted Mugs ",
        "--no-invalidate",
      ]);
      expect(renamed.exitCode).toBe(0);

      const db = new Database(dbPath);
      const row = db.query("SELECT id, name, slug FROM categories WHERE id = ?").get("ceramic-mugs") as {
        id: string;
        name: string;
        slug: string;
      } | null;
      expect(row).toEqual({
        id: "ceramic-mugs",
        name: "Handcrafted Mugs",
        slug: "handcrafted-mugs",
      });

      const slugs = db
        .query("SELECT old_slug, category_id FROM category_slugs WHERE category_id = ?")
        .all("ceramic-mugs") as Array<{ old_slug: string; category_id: string }>;
      expect(slugs).toEqual([{ old_slug: "ceramic-mugs", category_id: "ceramic-mugs" }]);

      const audit = db
        .query("SELECT details FROM admin_audit WHERE action = 'category.updated' AND target_id = ?")
        .get("ceramic-mugs") as { details: string } | null;
      expect(audit).not.toBeNull();
      expect(JSON.parse(audit!.details)).toMatchObject({
        name: "Handcrafted Mugs",
        slug: "handcrafted-mugs",
        oldSlug: "ceramic-mugs",
      });
      db.close();

      // Re-running with whitespace-padded identical slug must not create a self-redirect row.
      const sameSlug = runManage([
        "rename",
        "--db",
        dbPath,
        "--id",
        "ceramic-mugs",
        "--slug",
        " handcrafted-mugs ",
        "--no-invalidate",
      ]);
      expect(sameSlug.exitCode).toBe(0);

      const dbAfter = new Database(dbPath);
      const slugsAfter = dbAfter
        .query("SELECT old_slug FROM category_slugs WHERE category_id = ? ORDER BY old_slug")
        .all("ceramic-mugs") as Array<{ old_slug: string }>;
      expect(slugsAfter.map((r) => r.old_slug)).toEqual(["ceramic-mugs"]);
      dbAfter.close();
    },
    CLI_TIMEOUT_MS,
  );

  test(
    "rejects duplicate slug after trimming whitespace",
    () => {
      const dbPath = createTempCategoryDb();

      const conflict = runManage([
        "rename",
        "--db",
        dbPath,
        "--id",
        "ceramic-mugs",
        "--slug",
        " mugs ",
        "--no-invalidate",
      ]);
      expect(conflict.exitCode).toBe(1);
      expect(conflict.stderr).toContain('Conflict: another category already uses slug "mugs".');

      const db = new Database(dbPath);
      const row = db.query("SELECT id, name, slug FROM categories WHERE id = ?").get("ceramic-mugs") as {
        id: string;
        name: string;
        slug: string;
      } | null;
      expect(row).toEqual({
        id: "ceramic-mugs",
        name: "Ceramic Mugs",
        slug: "ceramic-mugs",
      });
      db.close();
    },
    CLI_TIMEOUT_MS,
  );
});

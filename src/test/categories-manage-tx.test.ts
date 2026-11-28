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
const MANAGE_SCRIPT = join(REPO_ROOT, "scripts/categories/manage.ts");

const tempDirs: string[] = [];

function createTempSqliteDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "cavara-cat-manage-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "local.sqlite");
  const sqlite = new Database(dbPath);
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles()) {
    sqlite.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  sqlite.close();
  return dbPath;
}

function runManage(dbPath: string, args: string[]) {
  return Bun.spawnSync(["bun", MANAGE_SCRIPT, ...args, "--db", dbPath, "--no-invalidate"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("scripts/categories/manage.ts stale slug cleanup and transactional writes (C4B-2)", () => {
  test(
    "create deletes stale category_slugs redirect row when reusing a retired slug",
    () => {
      const dbPath = createTempSqliteDb();

      // Create a category and rename its slug twice so "retired-mugs" is recorded in category_slugs
      // without colliding with the category's stable id ("ceramic-mugs").
      expect(
        runManage(dbPath, ["create", "--name", "Ceramic Mugs", "--slug", "ceramic-mugs", "--parent", "drinkware"])
          .exitCode,
      ).toBe(0);
      expect(runManage(dbPath, ["rename", "--id", "ceramic-mugs", "--slug", "retired-mugs"]).exitCode).toBe(0);
      expect(runManage(dbPath, ["rename", "--id", "ceramic-mugs", "--slug", "handcrafted-mugs"]).exitCode).toBe(0);

      // Verify "retired-mugs" currently exists as a redirect in category_slugs.
      {
        const db = new Database(dbPath);
        const stale = db
          .query("SELECT old_slug, category_id FROM category_slugs WHERE old_slug = ?")
          .get("retired-mugs") as { old_slug: string; category_id: string } | null;
        db.close();
        expect(stale).toEqual({ old_slug: "retired-mugs", category_id: "ceramic-mugs" });
      }

      // Creating a new category with slug "retired-mugs" must clear its stale redirect row.
      const created = runManage(dbPath, ["create", "--name", "Retired Mugs", "--slug", "retired-mugs"]);
      expect(created.exitCode).toBe(0);

      const db = new Database(dbPath);
      const remaining = db
        .query("SELECT old_slug, category_id FROM category_slugs WHERE old_slug = ?")
        .get("retired-mugs");
      const otherRedirect = db
        .query("SELECT old_slug, category_id FROM category_slugs WHERE old_slug = ?")
        .get("ceramic-mugs") as { old_slug: string; category_id: string } | null;
      db.close();

      expect(remaining).toBeNull();
      expect(otherRedirect).toEqual({ old_slug: "ceramic-mugs", category_id: "ceramic-mugs" });
    },
    CLI_TIMEOUT_MS,
  );

  test(
    "create rolls back category insert and slug cleanup atomically when a later write fails",
    () => {
      const dbPath = createTempSqliteDb();

      // Seed a retired slug redirect ("retired-mugs" -> "ceramic-mugs").
      expect(runManage(dbPath, ["create", "--name", "Ceramic Mugs", "--slug", "ceramic-mugs"]).exitCode).toBe(0);
      expect(runManage(dbPath, ["rename", "--id", "ceramic-mugs", "--slug", "retired-mugs"]).exitCode).toBe(0);
      expect(runManage(dbPath, ["rename", "--id", "ceramic-mugs", "--slug", "handcrafted-mugs"]).exitCode).toBe(0);

      // Inject a deterministic failure on the final audit write.
      {
        const db = new Database(dbPath);
        db.run(`
        CREATE TRIGGER fail_admin_audit_insert
        BEFORE INSERT ON admin_audit
        BEGIN
          SELECT RAISE(ABORT, 'simulated audit failure');
        END;
      `);
        db.close();
      }

      const failed = runManage(dbPath, ["create", "--name", "Retired Mugs", "--slug", "retired-mugs"]);
      expect(failed.exitCode).not.toBe(0);

      const db = new Database(dbPath);
      const cat = db.query("SELECT id FROM categories WHERE id = ?").get("retired-mugs");
      const redirect = db
        .query("SELECT old_slug, category_id FROM category_slugs WHERE old_slug = ?")
        .get("retired-mugs") as { old_slug: string; category_id: string } | null;
      db.close();

      expect(cat).toBeNull();
      expect(redirect).toEqual({ old_slug: "retired-mugs", category_id: "ceramic-mugs" });
    },
    CLI_TIMEOUT_MS,
  );

  test(
    "rename rolls back category update and redirect writes atomically when a later write fails",
    () => {
      const dbPath = createTempSqliteDb();
      expect(runManage(dbPath, ["create", "--name", "Ceramic Mugs", "--slug", "ceramic-mugs"]).exitCode).toBe(0);

      {
        const db = new Database(dbPath);
        db.run(`
        CREATE TRIGGER fail_admin_audit_insert
        BEFORE INSERT ON admin_audit
        BEGIN
          SELECT RAISE(ABORT, 'simulated audit failure');
        END;
      `);
        db.close();
      }

      const failed = runManage(dbPath, [
        "rename",
        "--id",
        "ceramic-mugs",
        "--slug",
        "handcrafted-mugs",
        "--name",
        "Handcrafted Mugs",
      ]);
      expect(failed.exitCode).not.toBe(0);

      const db = new Database(dbPath);
      const cat = db.query("SELECT name, slug FROM categories WHERE id = ?").get("ceramic-mugs") as {
        name: string;
        slug: string;
      } | null;
      const redirect = db.query("SELECT old_slug FROM category_slugs WHERE old_slug = ?").get("ceramic-mugs");
      db.close();

      expect(cat).toEqual({ name: "Ceramic Mugs", slug: "ceramic-mugs" });
      expect(redirect).toBeNull();
    },
    CLI_TIMEOUT_MS,
  );

  test(
    "move rolls back parent_id update atomically when a later write fails",
    () => {
      const dbPath = createTempSqliteDb();
      expect(runManage(dbPath, ["create", "--name", "Ceramic Mugs", "--slug", "ceramic-mugs"]).exitCode).toBe(0);

      {
        const db = new Database(dbPath);
        db.run(`
        CREATE TRIGGER fail_admin_audit_insert
        BEFORE INSERT ON admin_audit
        BEGIN
          SELECT RAISE(ABORT, 'simulated audit failure');
        END;
      `);
        db.close();
      }

      const failed = runManage(dbPath, ["move", "--id", "ceramic-mugs", "--parent", "drinkware"]);
      expect(failed.exitCode).not.toBe(0);

      const db = new Database(dbPath);
      const cat = db.query("SELECT parent_id FROM categories WHERE id = ?").get("ceramic-mugs") as {
        parent_id: string | null;
      } | null;
      db.close();

      expect(cat).toEqual({ parent_id: null });
    },
    CLI_TIMEOUT_MS,
  );
});

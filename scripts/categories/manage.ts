#!/usr/bin/env bun
/**
 * Agent-safe Category & Subcategory CLI with --dry-run support (C2.7 / 4b).
 *
 * Usage (local SQLite / wrangler local D1 file):
 *   bun scripts/categories/manage.ts list --db <sqlite-file>
 *   bun scripts/categories/manage.ts create --db <sqlite-file> --name "Ceramic Mugs" --slug ceramic-mugs [--parent drinkware] [--dry-run]
 *   bun scripts/categories/manage.ts rename --db <sqlite-file> --id ceramic-mugs --slug handcrafted-mugs [--name "Handcrafted Mugs"] [--dry-run]
 *   bun scripts/categories/manage.ts move --db <sqlite-file> --id ceramic-mugs --parent drinkware|none [--dry-run]
 */
import { Database } from "bun:sqlite";
import { categoryInputSchema, validateCategoryParent } from "../../src/domain/categories-admin";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const dryRun = args.includes("--dry-run");
const dbPath = flag("db");

/**
 * After a write: an audit row (action `category.created` / `category.updated`, actor "cli"), then the catalogue
 * snapshots are deleted so the next read rebuilds them with the new names, slugs and parents. Without that the shop
 * keeps serving the old slugs until something else rebuilds the summary. `--bucket` names the R2 bucket (default
 * cavara-images-dev), `--remote` targets the real bucket instead of the local one, `--no-invalidate` skips it.
 */
function afterWrite(
  action: "category.created" | "category.updated",
  targetId: string,
  details: Record<string, unknown>,
) {
  sqlite.run(
    "INSERT INTO admin_audit (id, actor_id, actor_username, actor_role, action, target_id, details, created_at) VALUES (?, 'cli', 'cli', 'owner', ?, ?, ?, ?)",
    [
      crypto.randomUUID(),
      action,
      targetId,
      JSON.stringify({ ...details, via: "scripts/categories/manage.ts" }),
      new Date().toISOString(),
    ],
  );
  if (args.includes("--no-invalidate")) {
    console.log(
      "Snapshots not invalidated (--no-invalidate). Delete snapshots/catalog-v4.json and catalog-v1.json before relying on the shop.",
    );
    return;
  }
  const bucket = flag("bucket") ?? "cavara-images-dev";
  const where = args.includes("--remote") ? "--remote" : "--local";
  for (const object of ["snapshots/catalog-v4.json", "snapshots/catalog-v1.json"]) {
    const run = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "delete", `${bucket}/${object}`, where], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (run.exitCode !== 0) console.error(`Could not delete ${bucket}/${object} (${where}). Delete it by hand.`);
  }
}

function usage(): never {
  console.error(
    "Usage: bun scripts/categories/manage.ts <list|create|rename|move> --db <sqlite-file> [options] [--dry-run]",
  );
  process.exit(1);
}

if (!command || !["list", "create", "rename", "move"].includes(command) || !dbPath) usage();

const sqlite = new Database(dbPath);
sqlite.run("PRAGMA foreign_keys = ON");

interface CatRow {
  id: string;
  name: string;
  slug: string | null;
  description: string;
  image: string;
  parent_id: string | null;
  sort: number;
  active: number;
}

const allCategories = () =>
  (
    sqlite
      .query("SELECT id, name, slug, description, image, parent_id, sort, active FROM categories ORDER BY sort, id")
      .all() as CatRow[]
  ).map((r) => ({ ...r, slug: r.slug || r.id, parentId: r.parent_id ?? null }));

if (command === "list") {
  const rows = allCategories();
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const existing = allCategories();

if (command === "create") {
  const parsed = categoryInputSchema.safeParse({
    id: null,
    name: flag("name") ?? "",
    slug: flag("slug") ?? "",
    description: flag("description") ?? "",
    image: flag("image") ?? "",
    parentId: flag("parent") ?? null,
    sort: Number.parseInt(flag("sort") ?? "0", 10) || 0,
    active: true,
  });
  if (!parsed.success) {
    console.error("Validation error:", parsed.error.issues.map((i) => i.message).join("; "));
    process.exit(1);
  }
  const err = validateCategoryParent(null, parsed.data.parentId, existing);
  if (err) {
    console.error("Hierarchy error:", err);
    process.exit(1);
  }
  const id = parsed.data.slug;
  if (existing.some((c) => c.id === id || c.slug === parsed.data.slug)) {
    console.error(`Conflict: category id or slug "${id}" already exists.`);
    process.exit(1);
  }
  const plan = { action: "create", dryRun, ...parsed.data, id };
  console.log(JSON.stringify(plan, null, 2));
  if (!dryRun) {
    sqlite.run(
      "INSERT INTO categories (id, name, slug, description, image, parent_id, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.description,
        parsed.data.image,
        parsed.data.parentId,
        parsed.data.sort,
        1,
      ],
    );
    afterWrite("category.created", id, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      parentId: parsed.data.parentId,
    });
    console.log(`Created category "${id}".`);
  }
  process.exit(0);
}

const targetId = flag("id");
if (!targetId) {
  console.error("Missing required --id <category-id>");
  process.exit(1);
}
const current = existing.find((c) => c.id === targetId);
if (!current) {
  console.error(`Category "${targetId}" not found.`);
  process.exit(1);
}

if (command === "rename") {
  const parsed = categoryInputSchema.safeParse({
    id: current.id,
    name: flag("name") ?? current.name,
    slug: flag("slug") ?? current.slug,
    description: current.description,
    image: current.image,
    parentId: current.parentId,
    sort: current.sort,
    active: current.active === 1,
  });
  if (!parsed.success) {
    console.error("Validation error:", parsed.error.issues.map((i) => i.message).join("; "));
    process.exit(1);
  }
  const nextSlug = parsed.data.slug;
  const nextName = parsed.data.name;
  if (existing.some((c) => c.id !== current.id && c.slug === nextSlug)) {
    console.error(`Conflict: another category already uses slug "${nextSlug}".`);
    process.exit(1);
  }
  const willRedirect = current.slug !== nextSlug;
  console.log(
    JSON.stringify(
      {
        action: "rename",
        dryRun,
        id: current.id,
        fromSlug: current.slug,
        toSlug: nextSlug,
        name: nextName,
        redirect301: willRedirect ? `/collections/${current.slug} -> ${nextSlug}` : null,
      },
      null,
      2,
    ),
  );
  if (!dryRun) {
    const now = new Date().toISOString();
    sqlite.run("UPDATE categories SET name = ?, slug = ? WHERE id = ?", [nextName, nextSlug, current.id]);
    if (willRedirect) {
      sqlite.run(
        "INSERT INTO category_slugs (old_slug, category_id, created_at) VALUES (?, ?, ?) ON CONFLICT (old_slug) DO UPDATE SET category_id = excluded.category_id, created_at = excluded.created_at",
        [current.slug, current.id, now],
      );
    }
    sqlite.run("DELETE FROM category_slugs WHERE old_slug = ?", [nextSlug]);
    afterWrite("category.updated", current.id, { name: nextName, slug: nextSlug, oldSlug: current.slug });
    console.log(`Renamed category "${current.id}" to slug "${nextSlug}".`);
  }
  process.exit(0);
}

if (command === "move") {
  const parentArg = flag("parent");
  if (!parentArg) {
    console.error("Missing required --parent <parent-id|none>");
    process.exit(1);
  }
  const nextParent = parentArg === "none" ? null : parentArg;
  const err = validateCategoryParent(current.id, nextParent, existing);
  if (err) {
    console.error("Hierarchy error:", err);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      { action: "move", dryRun, id: current.id, fromParent: current.parentId, toParent: nextParent },
      null,
      2,
    ),
  );
  if (!dryRun) {
    sqlite.run("UPDATE categories SET parent_id = ? WHERE id = ?", [nextParent, current.id]);
    afterWrite("category.updated", current.id, { fromParent: current.parentId, parentId: nextParent });
    console.log(`Moved category "${current.id}" under ${nextParent ?? "top-level"}.`);
  }
  process.exit(0);
}

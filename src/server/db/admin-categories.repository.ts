// Owner-only category & subcategory persistence with automatic old-slug 301 redirect tracking. Server-only.
import type { AdminIdentity } from "@/domain/admin";
import {
  type CategoryInput,
  type ManagedCategory,
  type SaveCategoryResult,
  validateCategoryParent,
} from "@/domain/categories-admin";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

interface CategoryDbRow {
  id: string;
  name: string;
  slug: string | null;
  description: string;
  image: string;
  parent_id: string | null;
  sort: number;
  active: number;
  product_count: number;
}

interface OldSlugRow {
  old_slug: string;
  category_id: string;
}

export async function listManagedCategories(db: D1Database): Promise<ManagedCategory[]> {
  const [catResult, slugResult] = await db.batch([
    db.prepare(
      `SELECT c.id, c.name, c.slug, c.description, c.image, c.parent_id, c.sort, c.active,
         (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c`,
    ),
    db.prepare("SELECT old_slug, category_id FROM category_slugs"),
  ]);
  const slugsByCat = new Map<string, string[]>();
  for (const row of (slugResult?.results ?? []) as OldSlugRow[]) {
    const list = slugsByCat.get(row.category_id) ?? [];
    list.push(row.old_slug);
    slugsByCat.set(row.category_id, list);
  }
  return ((catResult?.results ?? []) as CategoryDbRow[])
    .map((row): ManagedCategory => ({
      id: row.id,
      name: row.name,
      slug: row.slug || row.id,
      description: row.description,
      image: row.image,
      parentId: row.parent_id ?? null,
      sort: row.sort,
      active: row.active === 1,
      productCount: Number(row.product_count ?? 0),
      oldSlugs: (slugsByCat.get(row.id) ?? []).sort(),
    }))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export async function saveCategory(
  db: D1Database,
  actor: AdminIdentity,
  input: CategoryInput,
  now = new Date(),
): Promise<SaveCategoryResult> {
  const existing = await listManagedCategories(db);
  const current = input.id !== null ? existing.find((item) => item.id === input.id) : undefined;
  if (input.id !== null && !current) {
    return { ok: false, error: "That category no longer exists. Reload and try again." };
  }

  const hierarchyError = validateCategoryParent(input.id, input.parentId, existing);
  if (hierarchyError) return { ok: false, error: hierarchyError };

  const id = input.id ?? input.slug;
  if (input.id === null && existing.some((item) => item.id === id)) {
    return { ok: false, error: `A category with id "${id}" already exists.` };
  }
  if (existing.some((item) => item.id !== id && item.slug === input.slug)) {
    return { ok: false, error: `Another category already uses the URL name "${input.slug}".` };
  }

  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];

  if (current) {
    statements.push(
      db
        .prepare(
          `UPDATE categories SET name = ?, slug = ?, description = ?, image = ?, parent_id = ?, sort = ?, active = ?
           WHERE id = ?`,
        )
        .bind(
          input.name,
          input.slug,
          input.description,
          input.image,
          input.parentId,
          input.sort,
          input.active ? 1 : 0,
          id,
        ),
    );
    if (current.slug !== input.slug) {
      // Record the old slug so /collections/<old_slug> 301-redirects to this category.
      statements.push(
        db
          .prepare(
            `INSERT INTO category_slugs (old_slug, category_id, created_at) VALUES (?, ?, ?)
             ON CONFLICT (old_slug) DO UPDATE SET category_id = excluded.category_id, created_at = excluded.created_at`,
          )
          .bind(current.slug, id, at),
      );
    }
    // If reusing a previously retired slug, remove its stale redirect entry.
    statements.push(db.prepare("DELETE FROM category_slugs WHERE old_slug = ?").bind(input.slug));
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO categories (id, name, slug, description, image, parent_id, sort, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.name,
          input.slug,
          input.description,
          input.image,
          input.parentId,
          input.sort,
          input.active ? 1 : 0,
        ),
    );
    statements.push(db.prepare("DELETE FROM category_slugs WHERE old_slug = ?").bind(input.slug));
  }

  statements.push(
    auditStatement(
      db,
      actor,
      current ? "category.updated" : "category.created",
      id,
      { name: input.name, slug: input.slug, parent: input.parentId ?? "none", active: input.active ? "yes" : "no" },
      now,
    ),
  );

  await db.batch(statements);
  const updated = (await listManagedCategories(db)).find((item) => item.id === id);
  if (!updated) return { ok: false, error: "Could not read back the saved category." };
  return { ok: true, category: updated };
}

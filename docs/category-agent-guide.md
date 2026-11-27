# Category Management — Agent Guide

This guide explains how human operators and AI agents safely inspect, create, rename, and reorganize Cavara's two-level categories (`category › subcategory`).

## 1. Core Safety Model

1. **Stable internal `id`, changeable URL `slug`:**
   - Products reference `categories.id`. Never mutate `categories.id`.
   - Public URLs use `categories.slug` (`/collections/<slug>` or `/collections/<parent-slug>/<sub-slug>`).
   - Renaming a category's `slug` automatically inserts `(old_slug, category_id)` into `category_slugs`, so visits to the old URL return an HTTP `301` redirect to the new canonical path without touching D1 (served from Summary v4).
2. **Two-level hierarchy only:**
   - Top-level categories have `parent_id = NULL`.
   - Subcategories have `parent_id = <top-level-category-id>`.
   - Nesting a 3rd level or setting a category as its own parent is rejected by `validateCategoryParent()`.
3. **Never delete categories:**
   - Categories referenced by products cannot be deleted. Set `active = 0` to hide a category from the storefront while preserving product links.

## 2. CLI with `--dry-run` (`scripts/categories/manage.ts`)

Always run with `--dry-run` first to validate hierarchy constraints and preview any 301 redirect:

```bash
# List all categories and subcategories
bun scripts/categories/manage.ts list --db <path-to-local-sqlite>

# Preview creating a subcategory under drinkware
bun scripts/categories/manage.ts create --db <path-to-local-sqlite> \
  --name "Ceramic Mugs" --slug ceramic-mugs --parent drinkware --dry-run

# Preview renaming a slug (prints the 301 redirect that will be registered)
bun scripts/categories/manage.ts rename --db <path-to-local-sqlite> \
  --id ceramic-mugs --slug handcrafted-mugs --dry-run

# Preview moving a category to top-level or under another parent
bun scripts/categories/manage.ts move --db <path-to-local-sqlite> \
  --id ceramic-mugs --parent none --dry-run
```

Remove `--dry-run` only after reviewing the JSON plan.

## 3. WebMCP / Browser Agent Tools (`/admin/categories`)

When an Owner is signed in on `/admin/categories`, `CategoryManager` registers two WebMCP tools via `navigator.modelContext.registerTool`:

| Tool                     | Purpose                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cavara_list_categories` | Returns every category and subcategory with `id`, `slug`, `parentId`, `active`, `productCount`, and `oldSlugs`.                                                                        |
| `cavara_save_category`   | Creates or updates a category via `saveCategoryFn` (validates two-level hierarchy, records `category_slugs` 301 redirects, writes an audit row, and rebuilds the R2 catalog snapshot). |

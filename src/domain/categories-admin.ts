// Category & subcategory manager rules (two-level hierarchy, changeable slugs with 301 redirects). Pure: no React, no D1.
import { z } from "zod";
import { isImageKey } from "./media";
import { SLUG_PATTERN } from "./product-admin";

export const MAX_CATEGORIES = 60;

export const categoryInputSchema = z.object({
  /** Stable internal id; null when creating a new category (derived from slug). */
  id: z.string().trim().min(1).max(64).regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens").nullable(),
  name: z.string().trim().min(1, "Name the category").max(80),
  slug: z
    .string()
    .trim()
    .min(1, "Add a URL name")
    .max(64)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens"),
  description: z.string().trim().max(300).default(""),
  image: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || isImageKey(value), "Use an uploaded image key")
    .default(""),
  /** null for top-level category; parent's id for a level-2 subcategory. */
  parentId: z.string().trim().min(1).max(64).nullable().default(null),
  sort: z.number().int().min(-100_000).max(100_000).default(0),
  active: z.boolean().default(true),
});

export type CategoryInput = z.output<typeof categoryInputSchema>;

export interface ManagedCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  parentId: string | null;
  sort: number;
  active: boolean;
  productCount: number;
  oldSlugs: string[];
}

export type SaveCategoryResult =
  | { ok: true; category: ManagedCategory; warning?: string }
  | { ok: false; error: string };

/** Formats a category for dropdowns, prefixing level-2 subcategories with their parent's name. */
export function formatCategoryLabel(
  category: { id: string; name: string; parentId?: string | null },
  byId: ReadonlyMap<string, { name: string }>,
): string {
  if (!category.parentId) return category.name;
  const parent = byId.get(category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

const isCategoryActive = (flag?: boolean | number) => flag !== false && flag !== 0;

/** Validates two-level hierarchy constraints: a category cannot be its own parent, nest 3 levels deep, or orphan active subcategories. */
export function validateCategoryParent(
  id: string | null,
  parentId: string | null,
  existing: readonly { id: string; parentId: string | null; active?: boolean | number }[],
  active = true,
): string | null {
  if (!active && id !== null && existing.some((item) => item.parentId === id && isCategoryActive(item.active))) {
    return "This category has active subcategories; deactivate or move them before hiding it.";
  }
  if (parentId === null) return null;
  if (id !== null && id === parentId) return "A category cannot be its own parent.";
  const parent = existing.find((item) => item.id === parentId);
  if (!parent) return "The chosen parent category does not exist.";
  if (parent.parentId !== null) return "Categories support two levels only (category › subcategory).";
  if (active && !isCategoryActive(parent.active)) {
    return "The chosen parent category is inactive; activate it first or choose another parent.";
  }
  if (id !== null && existing.some((item) => item.parentId === id)) {
    return "This category has subcategories; move them out before making it a subcategory.";
  }
  return null;
}

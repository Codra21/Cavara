// Rules for the admin list's bulk actions and for duplicating a product. Pure: no React, no D1.
import { z } from "zod";
import { ADMIN_PAGE_SIZE } from "./admin-product-list";
import { pluralize } from "./catalog";
import type { ProductStatus } from "./product-admin";

/** One page of the list, so a selection never needs a second query to be understood. */
export const MAX_BULK_SELECTION = ADMIN_PAGE_SIZE;

const ids = z
  .array(z.number().int().positive())
  .min(1, "Select at least one product")
  .max(MAX_BULK_SELECTION, `Select at most ${MAX_BULK_SELECTION} products`)
  .refine((list) => new Set(list).size === list.length, "Each product can be selected once");

const plain = (action: "publish" | "unpublish" | "archive" | "feature" | "unfeature" | "new_arrival" | "clear_new_arrival") =>
  z.object({ action: z.literal(action), ids });

export const bulkProductActionSchema = z.discriminatedUnion("action", [
  plain("publish"),
  plain("unpublish"),
  plain("archive"),
  plain("feature"),
  plain("unfeature"),
  plain("new_arrival"),
  plain("clear_new_arrival"),
  z.object({ action: z.literal("set_category"), ids, categoryId: z.string().trim().min(1).max(40) }),
]);

export type BulkProductAction = z.output<typeof bulkProductActionSchema>;
export type BulkActionName = BulkProductAction["action"];

/** Why a selected product was left alone. `changed` means it moved on between the check and the write. */
export type BulkSkipReason = "not_found" | "unchanged" | "needs_picture" | "changed";

export interface BulkSkip {
  id: number;
  reason: BulkSkipReason;
}

export type BulkProductResult =
  | {
      ok: true;
      applied: number[];
      skipped: BulkSkip[];
      /** The applied products the shop shows (published before or after), whose cached copies need patching. */
      shopIds: number[];
      warning?: string;
    }
  | { ok: false; error: string };

/** What the planner needs to know about one selected product. */
export interface BulkProductState {
  id: number;
  status: ProductStatus;
  categoryId: string;
  featured: boolean;
  newArrival?: boolean;
  /** Has a colour, and every colour has a picture: the same rule productInputSchema applies to published products. */
  publishable: boolean;
}

export interface BulkPlan {
  /** Products the action will change, in the order selected. */
  apply: number[];
  /** The ones of those the shop shows before or after the action. */
  shop: number[];
  skipped: BulkSkip[];
}

/** Which of the selected products an action changes, judged against their current state. */
export function planBulkAction(action: BulkProductAction, states: BulkProductState[]): BulkPlan {
  const byId = new Map(states.map((state) => [state.id, state]));
  const apply: number[] = [];
  const shop: number[] = [];
  const skipped: BulkSkip[] = [];
  for (const id of action.ids) {
    const state = byId.get(id);
    if (!state) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    const reason = skipReason(action, state);
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    apply.push(id);
    // Drafts and archived products are not in the shop, so only publishing can change what the shop shows for them.
    if (state.status === "published" || action.action === "publish") shop.push(id);
  }
  return { apply, shop, skipped };
}

function skipReason(action: BulkProductAction, state: BulkProductState): BulkSkipReason | null {
  switch (action.action) {
    case "publish":
      if (state.status === "published") return "unchanged";
      return state.publishable ? null : "needs_picture";
    case "unpublish":
      return state.status === "published" ? null : "unchanged";
    case "archive":
      return state.status === "archived" ? "unchanged" : null;
    case "set_category":
      return state.categoryId === action.categoryId ? "unchanged" : null;
    case "feature":
      return state.featured ? "unchanged" : null;
    case "unfeature":
      return state.featured ? null : "unchanged";
    case "new_arrival":
      return state.newArrival ? "unchanged" : null;
    case "clear_new_arrival":
      return state.newArrival ? null : "unchanged";
  }
}

const PAST: Record<BulkActionName, string> = {
  publish: "Published",
  unpublish: "Unpublished",
  archive: "Archived",
  set_category: "Moved to the new category:",
  feature: "Marked as featured:",
  unfeature: "Removed from featured:",
  new_arrival: "Marked as new arrival:",
  clear_new_arrival: "Removed from new arrivals:",
};

const SKIP_TEXT: Record<BulkSkipReason, string> = {
  not_found: "no longer exist",
  unchanged: "already as asked",
  needs_picture: "need a colour with a picture before they can be published",
  changed: "changed while the action ran",
};

/** The sentence shown after an action, e.g. "Published 3 products. Left alone: 1 already as asked." */
export function describeBulkResult(action: BulkActionName, applied: number, skipped: BulkSkip[]): string {
  const done = applied > 0 ? `${PAST[action]} ${pluralize(applied, "product")}.` : "Nothing changed.";
  if (skipped.length === 0) return done;
  const counts = new Map<BulkSkipReason, number>();
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, count]) => `${pluralize(count, "product")} ${SKIP_TEXT[reason]}`);
  return `${done} Left alone: ${parts.join("; ")}.`;
}

export const duplicateProductSchema = z.object({
  id: z.number().int().positive(),
  /** Reuse the original's pictures. They share the same stored files; nothing is copied. */
  includeImages: z.boolean(),
});

export type DuplicateProductResult =
  | { ok: true; id: number; slug: string; revision: string; warning?: string }
  | { ok: false; error: string };

const MAX_SLUG = 80;
const MAX_NAME = 120;
const COPY_SUFFIX = "-copy";
/** Room for "-copy-999" so every candidate fits the 80-character URL name limit. */
const STEM_LENGTH = MAX_SLUG - `${COPY_SUFFIX}-999`.length;

/** The URL name every copy of this product starts from. Copies are `<stem>-copy`, `<stem>-copy-2`, `<stem>-copy-3`. */
export function copySlugStem(slug: string): string {
  return `${slug.slice(0, STEM_LENGTH).replace(/-+$/, "")}${COPY_SUFFIX}`;
}

/** First free URL name for a copy, given the names already taken. Null after 999 copies. */
export function nextCopySlug(slug: string, taken: ReadonlySet<string>): string | null {
  const stem = copySlugStem(slug);
  for (let n = 1; n <= 999; n++) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** Range of URL names that can collide with a copy's: from the stem up to (not including) the stem plus ".". */
export function copySlugRange(slug: string): { from: string; to: string } {
  const stem = copySlugStem(slug);
  // "-" sorts before ".", and a digit sorts after it, so this covers `<stem>` and `<stem>-<n>` and nothing like `<stem>2`.
  return { from: stem, to: `${stem}.` };
}

export const copyName = (name: string): string => {
  const suffix = " (copy)";
  return `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
};

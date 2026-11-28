// Rules for the paginated admin product list: filters, sorts, keyset cursors and page slicing. Pure: no React, no D1.
// The SQL lives in src/server/db/admin-product-list.repository.ts; the URL and the server function share these types.
import { z } from "zod";
import { MAX_PRICE, PRODUCT_STATUSES, type ProductStatus } from "./product-admin";

export const ADMIN_PAGE_SIZE = 50;

export const ADMIN_PRODUCT_SORTS = ["updated", "name", "price_asc", "price_desc"] as const;
export type AdminProductSort = (typeof ADMIN_PRODUCT_SORTS)[number];

export const ADMIN_SORT_LABELS: Record<AdminProductSort, string> = {
  updated: "Last updated",
  name: "Name, A to Z",
  price_asc: "Price, low to high",
  price_desc: "Price, high to low",
};

/** What the page URL holds. Every field is optional; a missing `sort` means "updated". */
export interface AdminProductSearch {
  status?: ProductStatus;
  category?: string;
  /** Only products with at least one out-of-stock colour. Absent means no filter. */
  outOfStock?: boolean;
  /** Only products with a counted colour holding LOW_STOCK_LIMIT or fewer. Absent means no filter. */
  lowStock?: boolean;
  sort?: AdminProductSort;
  /** The next page: rows after this cursor. */
  after?: string;
  /** The previous page: rows before this cursor. Never set together with `after`. */
  before?: string;
}

export type AdminProductQuery = AdminProductSearch & { sort: AdminProductSort };

/** The last row of a page: its sort value and id. Rows are ordered by (key, id), so this pair is unique. */
export interface ListCursor {
  key: string | number;
  id: number;
}

const MAX_ID = Number.MAX_SAFE_INTEGER;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function toToken(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromToken(token: string): string {
  const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeCursor(cursor: ListCursor): string {
  return toToken(JSON.stringify([cursor.key, cursor.id]));
}

/** The cursor a token holds for this sort, or null when it is malformed or has the wrong kind of key. */
export function decodeCursor(token: string, sort: AdminProductSort): ListCursor | null {
  try {
    const value: unknown = JSON.parse(fromToken(token));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [key, id] = value as unknown[];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return null;
    if (sort === "price_asc" || sort === "price_desc") {
      return typeof key === "number" && Number.isInteger(key) && key >= 0 && key <= MAX_PRICE ? { key, id } : null;
    }
    if (typeof key !== "string") return null;
    if (sort === "updated") return ISO_TIMESTAMP.test(key) ? { key, id } : null;
    return key.length >= 1 && key.length <= 120 ? { key, id } : null;
  } catch {
    return null;
  }
}

/** The column a sort orders by and the direction it runs. Every sort ends with the id, so the order is total. */
export interface SortSpec {
  column: "updated_at" | "name" | "price";
  direction: "asc" | "desc";
}

export const SORT_SPECS: Record<AdminProductSort, SortSpec> = {
  updated: { column: "updated_at", direction: "desc" },
  name: { column: "name", direction: "asc" },
  price_asc: { column: "price", direction: "asc" },
  price_desc: { column: "price", direction: "desc" },
};

/**
 * A cursor that sorts before every row (for ascending sorts) or after every row (for descending ones), so the first
 * page uses the same range query as any other page and SQLite always reads the index by a range.
 */
export function startCursor(sort: AdminProductSort): ListCursor {
  const spec = SORT_SPECS[sort];
  const ascending = spec.direction === "asc";
  if (spec.column === "price") return { key: ascending ? -1 : 2_147_483_647, id: ascending ? 0 : MAX_ID };
  if (spec.column === "name") return { key: "", id: 0 };
  return { key: "9999-12-31T23:59:59.999Z", id: MAX_ID };
}

const sortSchema = z.enum(ADMIN_PRODUCT_SORTS);
const tokenSchema = z
  .string()
  .max(1100)
  .regex(/^[A-Za-z0-9_-]+$/);

const listFields = {
  status: z.enum(PRODUCT_STATUSES).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  outOfStock: z.boolean().optional(),
  lowStock: z.boolean().optional(),
  sort: sortSchema.default("updated"),
  after: tokenSchema.optional(),
  before: tokenSchema.optional(),
};

/** Server function input. Rejects what the URL parser would repair, so a bad call fails instead of guessing. */
export const adminProductListSchema = z.object(listFields).superRefine((query, ctx) => {
  if (query.after !== undefined && query.before !== undefined) {
    ctx.addIssue({ code: "custom", path: ["before"], message: "Use either after or before" });
  }
  for (const field of ["after", "before"] as const) {
    const token = query[field];
    if (token !== undefined && !decodeCursor(token, query.sort)) {
      ctx.addIssue({ code: "custom", path: [field], message: "Unknown cursor" });
    }
  }
});

export const adminProductCountsSchema = z.object({ category: listFields.category });

function pick<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Reads the page URL's search params. Anything invalid is dropped (a bookmark with a stale cursor opens the first
 * page) rather than thrown, so a typo in the address bar never shows an error page.
 */
export function parseAdminProductSearch(raw: Record<string, unknown>): AdminProductSearch {
  const sort = pick(sortSchema, raw.sort);
  const effectiveSort = sort ?? "updated";
  const search: AdminProductSearch = {};
  const status = pick(listFields.status, raw.status);
  const category = pick(listFields.category, raw.category);
  if (status) search.status = status;
  if (category) search.category = category;
  if (raw.outOfStock === true) search.outOfStock = true;
  if (raw.lowStock === true) search.lowStock = true;
  if (sort && sort !== "updated") search.sort = sort;
  const after = pick(tokenSchema, raw.after);
  const before = pick(tokenSchema, raw.before);
  if (after && decodeCursor(after, effectiveSort)) search.after = after;
  else if (before && decodeCursor(before, effectiveSort)) search.before = before;
  return search;
}

export const withDefaultSort = (search: AdminProductSearch): AdminProductQuery => ({
  ...search,
  sort: search.sort ?? "updated",
});

/** Search params for the first page of a changed filter: drops the cursors and a default sort. */
export function firstPage(search: AdminProductSearch): AdminProductSearch {
  const { after: _after, before: _before, ...rest } = search;
  return rest.sort === "updated" ? { ...rest, sort: undefined } : rest;
}

export interface AdminPageSlice<T> {
  rows: T[];
  /** Token for `after`, or null on the last page. */
  next: string | null;
  /** Token for `before`, or null on the first page. */
  prev: string | null;
}

/**
 * Turns the rows a list query returned into one page. The query asks for one row more than a page (`pageSize + 1`):
 * its presence says another page exists in the direction of travel. `fetched` is in the order the query ran, which is
 * reversed when the request went backwards.
 */
export function sliceAdminPage<T>(
  fetched: T[],
  direction: "first" | "after" | "before",
  cursorOf: (row: T) => ListCursor,
  pageSize = ADMIN_PAGE_SIZE,
): AdminPageSlice<T> {
  const more = fetched.length > pageSize;
  const page = fetched.slice(0, pageSize);
  if (direction === "before") page.reverse();
  const first = page[0];
  const last = page.at(-1);
  const behind = direction === "first" ? false : direction === "after" ? true : more;
  const ahead = direction === "before" ? true : more;
  return {
    rows: page,
    next: ahead && last ? encodeCursor(cursorOf(last)) : null,
    prev: behind && first ? encodeCursor(cursorOf(first)) : null,
  };
}

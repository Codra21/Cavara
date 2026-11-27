// Owner-only reads behind /admin/products: one keyset page, counts per status, and the slim name list for search.
// Server-only; callers must have passed ownerAuthMiddleware.
//
// D1 read budget (code-standards): every statement below starts from an index (migration 0009), pages by keyset and
// has no temp B-tree. src/test/admin-product-list.test.ts checks the plan of each combination.
//   - A page is 1 or 2 product statements (51 rows each at most) and one statement for those products' colours.
//   - Counts are one grouped query over a covering index: about one index entry per product, so the page caches them.
//   - The name list reads every product once; it is the one deliberate full read and the browser keeps it all session.
import {
  ADMIN_PAGE_SIZE,
  type AdminProductQuery,
  decodeCursor,
  type ListCursor,
  SORT_SPECS,
  sliceAdminPage,
  startCursor,
} from "@/domain/admin-product-list";
import { mediaUrl } from "@/domain/media";
import { LOW_STOCK_LIMIT } from "@/domain/stock";
import type {
  AdminProductName,
  AdminProductPage,
  AdminProductSummary,
  AdminStatusCounts,
  ProductStatus,
} from "@/domain/product-admin";
import type { Availability } from "@/lib/types";
import type { D1Database } from "./d1";

interface ListRow {
  id: number;
  slug: string;
  name: string;
  category_id: string;
  price: number;
  cost_price: number | null;
  status: ProductStatus;
  featured: number;
  sort: number;
  updated_at: string;
}

interface ColourRow {
  variant_id: number;
  variant_name: string;
  product_id: number;
  position: number;
  availability: Availability;
  stock: number | null;
  path: string | null;
}

const COLUMNS =
  "p.id, p.slug, p.name, p.category_id, p.price, p.cost_price, p.status, p.featured, p.sort, p.updated_at";

// The literal 'out_of_stock' lets SQLite use the partial index idx_variants_out_of_stock; a bound parameter would not.
const HAS_OUT_OF_STOCK =
  "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.availability = 'out_of_stock')";

// Same for the partial index idx_variants_low_stock (WHERE stock IS NOT NULL AND stock <= 3): the predicate must repeat
// its literals. The number comes from LOW_STOCK_LIMIT, which migration 0010 hard-codes; a test keeps them equal.
const HAS_LOW_STOCK = `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock IS NOT NULL AND v.stock <= ${LOW_STOCK_LIMIT})`;

export interface ListStatement {
  sql: string;
  params: unknown[];
}

/**
 * The statements for one page, in the order their rows must be joined. Rows run in (sort key, id) order, so "after a
 * cursor" is a range on that pair. SQLite 3 uses a row-value comparison `(key, id) > (?, ?)` as an index range, except
 * with the NOCASE collation, which it scans from the start. The name sort therefore asks for the same range in two
 * parts: the rows that tie on the name (by id), then the rows with a later name. Their rows join in that order.
 *
 * The first page uses a cursor that sorts before every row (`startCursor`), so it too is a range. `before` runs the
 * sort backwards from the cursor; the caller reverses the rows.
 */
export function buildListStatements(query: AdminProductQuery, pageSize = ADMIN_PAGE_SIZE): ListStatement[] {
  const spec = SORT_SPECS[query.sort];
  const backward = query.before !== undefined;
  const token = query.after ?? query.before;
  const given = token === undefined ? null : decodeCursor(token, query.sort);
  const cursor = given ?? startCursor(query.sort);
  const direction = backward ? (spec.direction === "asc" ? "desc" : "asc") : spec.direction;
  const compare = direction === "asc" ? ">" : "<";
  const order = direction.toUpperCase();
  const key = spec.column === "name" ? "p.name COLLATE NOCASE" : `p.${spec.column}`;

  const where: string[] = [];
  const params: unknown[] = [];
  if (query.category !== undefined) {
    where.push("p.category_id = ?");
    params.push(query.category);
  }
  if (query.status !== undefined) {
    where.push("p.status = ?");
    params.push(query.status);
  }
  const outOfStock = [...(query.outOfStock ? [HAS_OUT_OF_STOCK] : []), ...(query.lowStock ? [HAS_LOW_STOCK] : [])];
  const limit = pageSize + 1;
  const select = (conditions: string[], orderBy: string): string =>
    `SELECT ${COLUMNS} FROM products p WHERE ${[...where, ...conditions, ...outOfStock].join(" AND ")} ORDER BY ${orderBy} LIMIT ?`;

  if (spec.column !== "name") {
    return [
      {
        sql: select([`(${key}, p.id) ${compare} (?, ?)`], `${key} ${order}, p.id ${order}`),
        params: [...params, cursor.key, cursor.id, limit],
      },
    ];
  }
  const statements: ListStatement[] = [];
  if (given) {
    statements.push({
      sql: select([`${key} = ?`, `p.id ${compare} ?`], `p.id ${order}`),
      params: [...params, cursor.key, cursor.id, limit],
    });
  }
  statements.push({
    sql: select([`${key} ${compare} ?`], `${key} ${order}, p.id ${order}`),
    params: [...params, cursor.key, limit],
  });
  return statements;
}

/** Colours of the page's products, with each colour's first picture. Starts at json_each, then two UNIQUE indexes. */
export const PAGE_COLOURS_SQL = `SELECT v.id AS variant_id, v.name AS variant_name, v.product_id, v.position, v.availability, v.stock, i.path
       FROM json_each(?) j
       JOIN product_variants v ON v.product_id = j.value
       LEFT JOIN product_images i ON i.variant_id = v.id AND i.position = 0`;

const cursorOf = (query: AdminProductQuery) => {
  const column = SORT_SPECS[query.sort].column;
  return (row: ListRow): ListCursor => ({
    key: column === "updated_at" ? row.updated_at : column === "name" ? row.name : row.price,
    id: row.id,
  });
};

/** One page of products (50 by default) in the query's sort, with colour counts and a thumbnail for each. */
export async function listAdminProducts(
  db: D1Database,
  query: AdminProductQuery,
  imageBase = "",
  pageSize = ADMIN_PAGE_SIZE,
): Promise<AdminProductPage> {
  const statements = buildListStatements(query, pageSize);
  const results = await db.batch<ListRow>(
    statements.map((statement) => db.prepare(statement.sql).bind(...statement.params)),
  );
  const fetched = results.flatMap((result) => result.results).slice(0, pageSize + 1);
  const direction = query.before !== undefined ? "before" : query.after !== undefined ? "after" : "first";
  const page = sliceAdminPage(fetched, direction, cursorOf(query), pageSize);
  if (page.rows.length === 0) return { products: [], next: null, prev: null };

  const { results: colours } = await db
    .prepare(PAGE_COLOURS_SQL)
    .bind(JSON.stringify(page.rows.map((row) => row.id)))
    .all<ColourRow>();
  const byProduct = new Map<number, ColourRow[]>();
  for (const colour of colours) {
    const list = byProduct.get(colour.product_id) ?? [];
    list.push(colour);
    byProduct.set(colour.product_id, list);
  }

  const products = page.rows.map((row): AdminProductSummary => {
    const own = (byProduct.get(row.id) ?? []).sort((a, b) => a.position - b.position);
    // The first colour that has a picture, as the shop's card does.
    const thumbnail = own.find((colour) => colour.path !== null)?.path ?? null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryId: row.category_id,
      price: row.price,
      costPrice: row.cost_price,
      status: row.status,
      featured: row.featured === 1,
      sort: row.sort,
      variantCount: own.length,
      outOfStockColours: own.filter((colour) => colour.availability === "out_of_stock").length,
      lowStockColours: own.filter((colour) => colour.stock !== null && colour.stock <= LOW_STOCK_LIMIT).length,
      variantStocks: own.map((colour) => ({
        id: colour.variant_id,
        name: colour.variant_name,
        stock: colour.stock,
        availability: colour.availability,
      })),
      thumbnail: thumbnail ? mediaUrl(imageBase, thumbnail) : null,
      updatedAt: row.updated_at,
    };
  });
  return { products, next: page.next, prev: page.prev };
}

/** Counts per status, for one category or all. One grouped query that walks a covering index, no temp B-tree. */
export const countsSql = (inCategory: boolean) =>
  `SELECT status, count(*) AS n FROM products${inCategory ? " WHERE category_id = ?" : ""} GROUP BY status`;

export async function countAdminProducts(db: D1Database, category?: string): Promise<AdminStatusCounts> {
  const statement = db.prepare(countsSql(category !== undefined));
  const { results } = await (category === undefined ? statement : statement.bind(category)).all<{
    status: ProductStatus;
    n: number;
  }>();
  const counts: AdminStatusCounts = { all: 0, draft: 0, published: 0, archived: 0 };
  for (const row of results) {
    counts[row.status] = row.n;
    counts.all += row.n;
  }
  return counts;
}

/**
 * Every product's id, name, slug and status, for the search box to filter in the browser. A full read of `products`
 * (about one row per product), with no ORDER BY so there is no temp B-tree. The browser keeps it for the session.
 */
export const PRODUCT_NAMES_SQL = "SELECT id, name, slug, status FROM products";

export async function listProductNames(db: D1Database): Promise<AdminProductName[]> {
  const { results } = await db.prepare(PRODUCT_NAMES_SQL).all<AdminProductName>();
  return results;
}

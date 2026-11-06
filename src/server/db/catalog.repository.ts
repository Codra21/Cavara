// Catalogue reads from D1. Server-only. Public reads return published products only and never cost_price.
import type { Availability, Catalog, Category, Product, Variant } from "@/lib/types";
import { mediaUrl } from "@/domain/media";
import type { D1Database } from "./d1";

interface CategoryRow {
  id: string;
  name: string;
  description: string;
  image: string;
}

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  category_id: string;
  summary: string;
  details: string;
  note: string | null;
  price: number;
}

/** One row per image; a variant without images comes back once with null image columns (LEFT JOIN). */
interface VariantImageRow {
  id: number;
  product_id: number;
  position: number;
  name: string;
  swatch: string;
  availability: Availability;
  image_position: number | null;
  path: string | null;
}

function parseDetails(raw: string, productId: number): string[] | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((item) => typeof item === "string"))
      return value.length ? value : undefined;
  } catch {
    // fall through
  }
  throw new Error(`products.details for product ${productId} is not a JSON array of strings`);
}

/**
 * The published catalogue in display order, with image keys turned into URLs (`imageBase` from IMAGE_BASE_URL).
 * One batch = one round trip and a consistent snapshot.
 *
 * D1 bills rows read, index entries included. Variants and images come from one join that starts at the
 * published products (idx_products_status_sort) and walks the UNIQUE (product_id, position) and
 * UNIQUE (variant_id, position) indexes. It has no ORDER BY, which would add a temp B-tree; rows are sorted here.
 * Request paths go through getCachedCatalog (src/server/catalog-cache.server.ts), not straight to this function.
 */
export async function getPublishedCatalog(db: D1Database, imageBase = ""): Promise<Catalog> {
  const [categoryResult, productResult, variantResult] = await db.batch([
    db.prepare("SELECT id, name, description, image FROM categories ORDER BY sort, id"),
    db.prepare(
      "SELECT id, slug, name, category_id, summary, details, note, price FROM products WHERE status = 'published' ORDER BY sort, id",
    ),
    db.prepare(
      `SELECT v.id, v.product_id, v.position, v.name, v.swatch, v.availability, i.position AS image_position, i.path
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN product_images i ON i.variant_id = v.id
       WHERE p.status = 'published'`,
    ),
  ]);

  const rows = [...((variantResult?.results ?? []) as VariantImageRow[])].sort(
    (a, b) =>
      a.product_id - b.product_id || a.position - b.position || (a.image_position ?? -1) - (b.image_position ?? -1),
  );

  const variantsByProduct = new Map<number, Variant[]>();
  let currentVariant: { id: number; images: string[] } | undefined;
  for (const row of rows) {
    if (row.id !== currentVariant?.id) {
      const list = variantsByProduct.get(row.product_id) ?? [];
      // position is the variant index saved in bags; positions must be 0..n-1 without gaps.
      if (row.position !== list.length)
        throw new Error(`product ${row.product_id} has a gap at variant position ${list.length}`);
      currentVariant = { id: row.id, images: [] };
      list.push({ name: row.name, swatch: row.swatch, images: currentVariant.images, availability: row.availability });
      variantsByProduct.set(row.product_id, list);
    }
    if (row.path !== null) currentVariant.images.push(mediaUrl(imageBase, row.path));
  }

  const categories: Category[] = ((categoryResult?.results ?? []) as CategoryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    image: mediaUrl(imageBase, row.image),
  }));

  const products: Product[] = ((productResult?.results ?? []) as ProductRow[]).flatMap((row) => {
    const [first, ...rest] = variantsByProduct.get(row.id) ?? [];
    // A product without any colour cannot be shown or bagged; skip it rather than break the page.
    if (!first) return [];
    const product: Product = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category_id,
      price: row.price,
      summary: row.summary,
      variants: [first, ...rest],
    };
    const details = parseDetails(row.details, row.id);
    if (details) product.details = details;
    if (row.note) product.note = row.note;
    return [product];
  });

  return { categories, products, imageBase };
}

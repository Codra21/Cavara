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

interface VariantRow {
  id: number;
  product_id: number;
  position: number;
  name: string;
  swatch: string;
  availability: Availability;
}

interface ImageRow {
  variant_id: number;
  path: string;
}

const PUBLISHED_PRODUCTS = "SELECT id FROM products WHERE status = 'published'";

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
 */
export async function getPublishedCatalog(db: D1Database, imageBase = ""): Promise<Catalog> {
  const [categoryResult, productResult, variantResult, imageResult] = await db.batch([
    db.prepare("SELECT id, name, description, image FROM categories ORDER BY sort, id"),
    db.prepare(
      "SELECT id, slug, name, category_id, summary, details, note, price FROM products WHERE status = 'published' ORDER BY sort, id",
    ),
    db.prepare(
      `SELECT id, product_id, position, name, swatch, availability FROM product_variants
       WHERE product_id IN (${PUBLISHED_PRODUCTS}) ORDER BY product_id, position`,
    ),
    db.prepare(
      `SELECT i.variant_id, i.path FROM product_images i JOIN product_variants v ON v.id = i.variant_id
       WHERE v.product_id IN (${PUBLISHED_PRODUCTS}) ORDER BY i.variant_id, i.position`,
    ),
  ]);

  const imagesByVariant = new Map<number, string[]>();
  for (const image of (imageResult?.results ?? []) as ImageRow[]) {
    const list = imagesByVariant.get(image.variant_id) ?? [];
    list.push(mediaUrl(imageBase, image.path));
    imagesByVariant.set(image.variant_id, list);
  }

  const variantsByProduct = new Map<number, Variant[]>();
  for (const row of (variantResult?.results ?? []) as VariantRow[]) {
    const list = variantsByProduct.get(row.product_id) ?? [];
    // position is the variant index saved in bags; positions must be 0..n-1 without gaps.
    if (row.position !== list.length)
      throw new Error(`product ${row.product_id} has a gap at variant position ${list.length}`);
    list.push({
      name: row.name,
      swatch: row.swatch,
      images: imagesByVariant.get(row.id) ?? [],
      availability: row.availability,
    });
    variantsByProduct.set(row.product_id, list);
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

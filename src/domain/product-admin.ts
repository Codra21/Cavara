// Product editor rules shared by the admin form and the server functions. Pure: no React, no D1.
import { z } from "zod";
import type { Availability } from "@/lib/types";

export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder"] as const satisfies readonly Availability[];

/** Caps keep one save inside a single D1 batch with few statements. */
export const MAX_VARIANTS = 12;
export const MAX_IMAGES_PER_VARIANT = 12;
export const MAX_DETAILS = 12;
export const MAX_PRICE = 10_000_000;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Colours and gradients only. No url(), quotes or semicolons, so a swatch cannot load remote content. */
const SWATCH_PATTERN = /^[#a-zA-Z0-9(),.%\s-]+$/;
/** Images already in the catalogue. Uploads (R2) add their own prefix in unit 6b. */
export const IMAGE_PATH_PATTERN = /^\/product-images\/[A-Za-z0-9._\-/]+$/;

const money = z.number().int().min(0).max(MAX_PRICE);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

export const variantInputSchema = z.object({
  /** null for a colour added in this edit. */
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1, "Name the colour").max(60),
  swatch: z
    .string()
    .trim()
    .min(1, "Add a swatch colour")
    .max(300)
    .regex(SWATCH_PATTERN, "Use a colour like #E0799C or a CSS gradient")
    .refine((value) => !/url\s*\(/i.test(value), "Swatches cannot load images"),
  availability: z.enum(AVAILABILITIES),
  images: z.array(z.string().regex(IMAGE_PATH_PATTERN, "Unknown image path")).max(MAX_IMAGES_PER_VARIANT),
});

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name the product").max(120),
    slug: z
      .string()
      .trim()
      .min(1, "Add a URL name")
      .max(80)
      .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens"),
    categoryId: z.string().trim().min(1, "Pick a category").max(40),
    summary: z.string().trim().max(500),
    details: z.array(z.string().trim().min(1).max(300)).max(MAX_DETAILS),
    note: optionalText(300),
    price: money.min(1, "Price must be at least ৳1"),
    regularPrice: money.min(1).nullable(),
    costPrice: money.nullable(),
    status: z.enum(PRODUCT_STATUSES),
    featured: z.boolean(),
    sort: z.number().int().min(-100_000).max(100_000),
    variants: z.array(variantInputSchema).max(MAX_VARIANTS),
  })
  .superRefine((product, ctx) => {
    // The storefront cannot show or bag a product without a colour that has a picture.
    if (product.status !== "published") return;
    if (product.variants.length === 0) {
      ctx.addIssue({ code: "custom", path: ["variants"], message: "Add at least one colour before publishing" });
    }
    product.variants.forEach((variant, index) => {
      if (variant.images.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "images"],
          message: `"${variant.name || `Colour ${index + 1}`}" needs a picture before publishing`,
        });
      }
    });
  });

export type ProductInput = z.output<typeof productInputSchema>;
export type ProductFormValues = z.input<typeof productInputSchema>;
export type VariantInput = z.output<typeof variantInputSchema>;

export const saveProductSchema = z.object({
  /** null creates a new product. */
  id: z.number().int().positive().nullable(),
  /** The revision the editor loaded; ignored when creating. */
  revision: z.string().max(64),
  product: productInputSchema,
});

export type SaveProductRequest = z.input<typeof saveProductSchema>;

export interface AdminVariant {
  id: number;
  name: string;
  swatch: string;
  availability: Availability;
  images: string[];
}

export interface AdminProduct {
  id: number;
  slug: string;
  name: string;
  categoryId: string;
  summary: string;
  details: string[];
  note: string | null;
  price: number;
  regularPrice: number | null;
  costPrice: number | null;
  status: ProductStatus;
  featured: boolean;
  sort: number;
  revision: string;
  updatedAt: string;
  variants: AdminVariant[];
}

export interface AdminProductSummary {
  id: number;
  slug: string;
  name: string;
  categoryId: string;
  price: number;
  costPrice: number | null;
  status: ProductStatus;
  featured: boolean;
  sort: number;
  variantCount: number;
  thumbnail: string | null;
  updatedAt: string;
}

export interface AdminCategory {
  id: string;
  name: string;
}

export type SaveProductResult =
  | { ok: true; id: number; revision: string }
  | { ok: false; error: string; conflict?: boolean };

/** Turns a product name into a URL name: "Red Polka Bow Cup & Plate" → "red-polka-bow-cup-plate". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Margin per unit sold, or null when the cost is unknown. Profit uses the same formula: (price − cost) × qty. */
export function unitMargin(price: number, costPrice: number | null): number | null {
  return costPrice === null ? null : price - costPrice;
}

/** Empty form for a new product: a draft with no colours yet. */
export function emptyProductForm(categoryId = ""): ProductFormValues {
  return {
    name: "",
    slug: "",
    categoryId,
    summary: "",
    details: [],
    note: "",
    price: 0,
    regularPrice: null,
    costPrice: null,
    status: "draft",
    featured: false,
    sort: 0,
    variants: [],
  };
}

export function productToForm(product: AdminProduct): ProductFormValues {
  return {
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    summary: product.summary,
    details: product.details,
    note: product.note ?? "",
    price: product.price,
    regularPrice: product.regularPrice,
    costPrice: product.costPrice,
    status: product.status,
    featured: product.featured,
    sort: product.sort,
    variants: product.variants.map((variant) => ({ ...variant, images: [...variant.images] })),
  };
}

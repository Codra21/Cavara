import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { type ProductFormValues, productInputSchema, productToForm, slugify, unitMargin } from "@/domain/product-admin";
import { mediaUrl } from "@/domain/media";
import { listAudit } from "@/server/admin/auth.server";
import { getAdminProduct, listAdminProducts, saveProduct } from "@/server/db/admin-catalog.repository";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { createTestD1, type TestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const IMG = "product-images/test/a.webp";

function form(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    name: "Test Mug",
    slug: "test-mug",
    categoryId: "drinkware",
    summary: "A mug.",
    details: ["350 ml"],
    note: "",
    price: 1200,
    regularPrice: null,
    costPrice: 700,
    status: "draft",
    featured: false,
    sort: 999,
    variants: [{ id: null, name: "Sage", swatch: "#9CCB91", availability: "in_stock", images: [IMG] }],
    ...overrides,
  };
}

const parse = (values: ProductFormValues) => productInputSchema.parse(values);

async function create(db: TestD1, values = form()) {
  const result = await saveProduct(db, { actor: owner, id: null, revision: "", input: parse(values) });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("productInputSchema", () => {
  test("publishing needs a colour with a picture", () => {
    expect(productInputSchema.safeParse(form({ status: "published", variants: [] })).success).toBe(false);
    const noImage = form({
      status: "published",
      variants: [{ id: null, name: "Sage", swatch: "#fff", availability: "in_stock", images: [] }],
    });
    expect(productInputSchema.safeParse(noImage).success).toBe(false);
    expect(productInputSchema.safeParse(form({ status: "published" })).success).toBe(true);
    // Drafts may be incomplete.
    expect(productInputSchema.safeParse(form({ variants: [] })).success).toBe(true);
  });
  test("rejects unsafe swatches, slugs and image paths", () => {
    const variant = (swatch: string) => [
      { id: null, name: "x", swatch, availability: "in_stock" as const, images: [] },
    ];
    expect(productInputSchema.safeParse(form({ variants: variant("url(https://evil.example/x.png)") })).success).toBe(
      false,
    );
    expect(productInputSchema.safeParse(form({ variants: variant("red; position: fixed") })).success).toBe(false);
    expect(
      productInputSchema.safeParse(
        form({ variants: variant("linear-gradient(135deg, #C9A45C 0 50%, #D8DADB 50% 100%)") }),
      ).success,
    ).toBe(true);
    expect(productInputSchema.safeParse(form({ slug: "Bad Slug" })).success).toBe(false);
    const badImage = [
      {
        id: null,
        name: "x",
        swatch: "#fff",
        availability: "in_stock" as const,
        images: ["https://evil.example/a.png"],
      },
    ];
    expect(productInputSchema.safeParse(form({ variants: badImage })).success).toBe(false);
  });
  test("blank note becomes null; price must be a positive whole number", () => {
    expect(parse(form({ note: "  " })).note).toBeNull();
    expect(productInputSchema.safeParse(form({ price: 0 })).success).toBe(false);
    expect(productInputSchema.safeParse(form({ price: 10.5 })).success).toBe(false);
  });
});

describe("slugify and margin", () => {
  test("slugify", () => {
    expect(slugify("Red Polka Bow Cup & Bread Plate")).toBe("red-polka-bow-cup-bread-plate");
    expect(slugify("  Café — Ümlaut (Set)  ")).toBe("cafe-umlaut-set");
  });
  test("unit margin", () => {
    expect(unitMargin(1200, 700)).toBe(500);
    expect(unitMargin(1200, null)).toBeNull();
  });
});

describe("saveProduct", () => {
  test("creates a draft that the storefront does not show, with an audit row", async () => {
    const db = createTestD1();
    const before = (await getPublishedCatalog(db)).products.length;
    const { id } = await create(db);
    const product = await getAdminProduct(db, id);
    expect(product?.name).toBe("Test Mug");
    expect(product?.costPrice).toBe(700);
    expect(product?.variants.map((v) => v.images)).toEqual([[IMG]]);
    expect((await getPublishedCatalog(db)).products.length).toBe(before);
    const audit = await listAudit(db);
    expect(audit[0]).toMatchObject({
      action: "product.created",
      targetId: String(id),
      details: { name: "Test Mug", costPrice: 700 },
    });
  });

  test("publishing shows it on the storefront without cost price", async () => {
    const db = createTestD1();
    const { id, revision } = await create(db);
    const product = await getAdminProduct(db, id);
    const result = await saveProduct(db, {
      actor: owner,
      id,
      revision,
      input: parse({ ...productToForm(product!), status: "published" }),
    });
    expect(result.ok).toBe(true);
    const shown = (await getPublishedCatalog(db)).products.find((p) => p.id === id);
    expect(shown?.slug).toBe("test-mug");
    expect(JSON.stringify(shown)).not.toContain("700");
  });

  test("a stale revision changes nothing at all", async () => {
    const db = createTestD1();
    const { id, revision } = await create(db);
    const loaded = productToForm((await getAdminProduct(db, id))!);
    const first = await saveProduct(db, { actor: owner, id, revision, input: parse({ ...loaded, name: "First tab" }) });
    expect(first.ok).toBe(true);
    const auditBefore = (await listAudit(db)).length;
    const second = await saveProduct(db, {
      actor: owner,
      id,
      revision,
      input: parse({ ...loaded, name: "Second tab", variants: [] }),
    });
    expect(second).toMatchObject({ ok: false, conflict: true });
    const after = await getAdminProduct(db, id);
    expect(after?.name).toBe("First tab");
    expect(after?.variants).toHaveLength(1);
    expect((await listAudit(db)).length).toBe(auditBefore);
  });

  test("reorders, edits, adds and removes colours with gap-free positions", async () => {
    const db = createTestD1();
    const twoColours = form({
      variants: [
        {
          id: null,
          name: "Sage",
          swatch: "#9CCB91",
          availability: "in_stock",
          images: [IMG, "product-images/test/b.webp"],
        },
        {
          id: null,
          name: "Rose",
          swatch: "#F4B8C7",
          availability: "preorder",
          images: ["product-images/test/c.webp"],
        },
      ],
    });
    const { id, revision } = await create(db, twoColours);
    const loaded = (await getAdminProduct(db, id))!;
    const [sage, rose] = loaded.variants;
    const edited = await saveProduct(db, {
      actor: owner,
      id,
      revision,
      input: parse({
        ...productToForm(loaded),
        variants: [
          { ...rose!, name: "Blush", images: ["product-images/test/c.webp"] },
          { id: null, name: "Ink", swatch: "#26332f", availability: "out_of_stock", images: [] },
        ],
      }),
    });
    expect(edited.ok).toBe(true);
    const after = (await getAdminProduct(db, id))!;
    expect(after.variants.map((v) => [v.name, v.images.length])).toEqual([
      ["Blush", 1],
      ["Ink", 0],
    ]);
    expect(after.variants[0]?.id).toBe(rose!.id);
    expect(after.variants.some((v) => v.id === sage!.id)).toBe(false);
    const positions = db.sqlite
      .query("SELECT position FROM product_variants WHERE product_id = ? ORDER BY position")
      .all(id);
    expect(positions).toEqual([{ position: 0 }, { position: 1 }]);
    const orphanImages = db.sqlite
      .query("SELECT count(*) AS n FROM product_images WHERE variant_id NOT IN (SELECT id FROM product_variants)")
      .get() as { n: number };
    expect(orphanImages.n).toBe(0);
  });

  test("rejects a colour id from another product", async () => {
    const db = createTestD1();
    const a = await create(db);
    const b = await create(db, form({ slug: "other-mug", name: "Other" }));
    const otherVariant = (await getAdminProduct(db, b.id))!.variants[0]!;
    const loaded = productToForm((await getAdminProduct(db, a.id))!);
    const result = await saveProduct(db, {
      actor: owner,
      id: a.id,
      revision: a.revision,
      input: parse({ ...loaded, variants: [otherVariant] }),
    });
    expect(result).toMatchObject({ ok: false, conflict: true });
  });

  test("duplicate slug and unknown category are friendly errors", async () => {
    const db = createTestD1();
    await create(db);
    const dup = await saveProduct(db, { actor: owner, id: null, revision: "", input: parse(form()) });
    expect(dup).toEqual({ ok: false, error: "Another product already uses this URL name." });
    const badCategory = await saveProduct(db, {
      actor: owner,
      id: null,
      revision: "",
      input: parse(form({ slug: "x", categoryId: "nope" })),
    });
    expect(badCategory.ok).toBe(false);
  });

  test("archiving stamps archived_at, hides the product and sorts it last in the admin list", async () => {
    const db = createTestD1();
    const { id, revision } = await create(db, form({ status: "published", sort: -5 }));
    expect((await listAdminProducts(db))[0]?.id).toBe(id);
    const loaded = productToForm((await getAdminProduct(db, id))!);
    await saveProduct(db, { actor: owner, id, revision, input: parse({ ...loaded, status: "archived" }) });
    const row = db.sqlite.query("SELECT archived_at FROM products WHERE id = ?").get(id) as {
      archived_at: string | null;
    };
    expect(row.archived_at).not.toBeNull();
    expect((await getPublishedCatalog(db)).products.some((p) => p.id === id)).toBe(false);
    const list = await listAdminProducts(db);
    expect(list.at(-1)?.id).toBe(id);
    expect(list.find((p) => p.id === id)?.thumbnail).toBe(`/media/${IMG}`);
  });

  test("seeded products (blank revision) can be edited", async () => {
    const db = createTestD1();
    const [first] = await listAdminProducts(db);
    const loaded = (await getAdminProduct(db, first!.id))!;
    expect(loaded.revision).toBe("");
    const result = await saveProduct(db, {
      actor: owner,
      id: loaded.id,
      revision: "",
      input: parse({ ...productToForm(loaded), costPrice: 300 }),
    });
    expect(result.ok).toBe(true);
    // Saving a seeded product unchanged keeps the storefront identical (apart from cost price, which is private).
    const shown = (await getPublishedCatalog(db)).products.find((p) => p.id === loaded.id);
    expect(shown?.variants.length).toBe(loaded.variants.length);
    expect(shown?.variants[0]?.images).toEqual(loaded.variants[0]!.images.map((key) => mediaUrl("", key)));
  });
});

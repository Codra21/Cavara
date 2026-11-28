import { describe, expect, test } from "bun:test";
import {
  decodeDetail,
  decodeSummary,
  encodeDetail,
  encodeSummary,
  type ProductDetail,
  resolveCard,
  resolveProduct,
  toLegacyProduct,
  toProductSummary,
} from "@/domain/catalog-snapshot";
import { isSafeSwatch, variantInputSchema } from "@/domain/product-admin";
import { safeSwatch } from "@/domain/swatch";

const VALID_SWATCHES = [
  "#fff",
  "#000",
  "#c00",
  "#fff8",
  "#EDE2C7",
  "#9CCB91",
  "#26332f",
  "#9CCB91CC",
  "rgb(255, 128, 0)",
  "rgba(255, 128, 0, 0.5)",
  "rgb(255 128 0 / 50%)",
  "hsl(120, 50%, 50%)",
  "hsla(120deg, 50%, 50%, 0.5)",
  "hsl(120 50% 50% / 0.5)",
  "linear-gradient(135deg, #C9A45C 0 50%, #D8DADB 50% 100%)",
  "linear-gradient(to right, #fff, #000)",
  "radial-gradient(circle at center, #fff 0%, rgba(0, 0, 0, 0.5) 100%)",
  "conic-gradient(from 20deg, #e86f68, #f2c45f, #79b87b, #77a8d8, #b685c7, #e86f68)",
];

const UNSAFE_SWATCHES = [
  "",
  "   ",
  "url(https://evil.com/x.png)",
  "url/**/(https://evil.com)",
  'image-set("https://evil.com/x.png")',
  "image-set(url(https://evil.com/x.png) 1x)",
  "-webkit-image-set(url(https://evil.com/x.png) 1x)",
  "var(--x)",
  "var(--x, #fff)",
  "; background-image: url(https://evil.com/x.png)",
  "#fff; background-image: url(https://evil.com/x.png)",
  "expression(alert(1))",
  "linear-gradient(135deg, var(--x), #fff)",
  "linear-gradient(135deg, url(https://evil.com/x.png), #fff)",
  "rgb(var(--r), 0, 0)",
  "/* comment */ #fff",
  "linear-gradient(135deg, #fff)",
  "linear-gradient(135deg, #fff, #000))",
  "#12",
  "#gggggg",
  `linear-gradient(135deg, ${Array.from({ length: 40 }, () => "#ffffff").join(", ")})`,
];

function makeVariant(swatch: string) {
  return {
    id: null,
    name: "Test",
    swatch,
    availability: "in_stock" as const,
    images: [],
  };
}

function makeProductDetail(swatch: string): ProductDetail {
  return {
    id: 1,
    slug: "test-mug",
    name: "Test Mug",
    category: "drinkware",
    price: 1200,
    regularPrice: null,
    featured: false,
    newArrival: false,
    weightG: null,
    createdAt: "2026-01-01",
    sort: 1,
    summary: "A mug.",
    details: [],
    note: null,
    variants: [
      {
        name: "Test",
        swatch,
        availability: "in_stock",
        images: ["product-images/test/a.webp"],
        stock: null,
      },
    ],
  };
}

describe("S2B-7: swatch allowlist validation", () => {
  test("isSafeSwatch and safeSwatch accept all valid Cavara swatch formats", () => {
    for (const swatch of VALID_SWATCHES) {
      expect(isSafeSwatch(swatch), `expected valid swatch to pass: ${swatch}`).toBe(true);
      expect(safeSwatch(`  ${swatch}  `)).toBe(swatch);
    }
  });

  test("isSafeSwatch and safeSwatch reject CSS injection, comments, and external resources", () => {
    for (const swatch of UNSAFE_SWATCHES) {
      expect(isSafeSwatch(swatch), `expected unsafe swatch to fail: ${swatch}`).toBe(false);
      expect(safeSwatch(swatch)).toBe("");
    }
  });

  test("variantInputSchema accepts all valid Cavara swatch formats", () => {
    for (const swatch of VALID_SWATCHES) {
      const result = variantInputSchema.safeParse(makeVariant(swatch));
      expect(result.success, `expected valid swatch to pass: ${swatch}`).toBe(true);
    }
  });

  test("variantInputSchema rejects CSS injection and external resource swatches", () => {
    for (const swatch of UNSAFE_SWATCHES) {
      const result = variantInputSchema.safeParse(makeVariant(swatch));
      expect(result.success, `expected unsafe swatch to fail: ${swatch}`).toBe(false);
    }
  });

  test("catalog-snapshot preserves valid swatches and sanitizes unsafe swatches on read and projection", () => {
    const valid = "conic-gradient(from 20deg, #e86f68, #f2c45f, #79b87b, #77a8d8, #b685c7, #e86f68)";
    const validDetail = makeProductDetail(valid);
    expect(toProductSummary(validDetail).variants[0]?.swatch).toBe(valid);
    expect(resolveProduct(validDetail, "").variants[0]?.swatch).toBe(valid);

    for (const bad of [
      "url/**/(https://evil.com)",
      'image-set("https://evil.com/x.png")',
      "var(--x)",
      "; background-image: url(https://evil.com/x.png)",
    ]) {
      const detail = makeProductDetail(bad);

      const summaryProduct = toProductSummary(detail);
      expect(summaryProduct.variants[0]?.swatch).toBe("");

      const legacy = toLegacyProduct(detail, "https://img.example");
      expect(legacy.variants[0]?.swatch).toBe("");

      const card = resolveCard({ ...summaryProduct, variants: [{ ...summaryProduct.variants[0]!, swatch: bad }] }, "");
      expect(card.variants[0]?.swatch).toBe("");

      const pub = resolveProduct(detail, "");
      expect(pub.variants[0]?.swatch).toBe("");

      const encodedSummary = encodeSummary({
        gen: "g1",
        categories: [],
        zones: [],
        sales: [],
        products: [{ ...summaryProduct, variants: [{ ...summaryProduct.variants[0]!, swatch: bad }] }],
      });
      const decodedSummary = decodeSummary(encodedSummary);
      expect(decodedSummary.products[0]?.variants[0]?.swatch).toBe("");

      const encodedDetail = encodeDetail({ gen: "g1", product: detail });
      const decodedDetail = decodeDetail(encodedDetail);
      expect(decodedDetail.product.variants[0]?.swatch).toBe("");
    }
  });
});

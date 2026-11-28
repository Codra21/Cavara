import { describe, expect, test } from "bun:test";
import { resolveCategory, toLegacyCatalog } from "@/domain/catalog-snapshot";
import { contentTypeForKey, isImageKey, mediaUrl, sniffImageType } from "@/domain/media";
import type { Category } from "@/lib/types";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { createTestD1 } from "./helpers/d1";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("isImageKey", () => {
  test("accepts migrated and uploaded keys", () => {
    expect(isImageKey("product-images/storage-jar/storage-jar.webp")).toBe(true);
    expect(isImageKey(`products/12/${UUID}.webp`)).toBe(true);
    expect(isImageKey(`products/new/${UUID}.jpg`)).toBe(true);
  });
  test("rejects paths, traversal, other prefixes and non-images", () => {
    for (const bad of [
      "/product-images/a.webp",
      "product-images/../secrets/a.webp",
      "backups/db.sql",
      "product-images/a.svg",
      "products/12/not-a-uuid.webp",
      "https://evil.example/a.webp",
      "product-images/a b.webp",
    ]) {
      expect(isImageKey(bad)).toBe(false);
    }
  });
});

describe("mediaUrl", () => {
  test("Worker route without a base, custom domain with one, old static paths unchanged", () => {
    expect(mediaUrl("", "product-images/a/b.webp")).toBe("/media/product-images/a/b.webp");
    expect(mediaUrl("https://images.cavarabd.com", "product-images/a/b.webp")).toBe(
      "https://images.cavarabd.com/product-images/a/b.webp",
    );
    expect(mediaUrl("https://images.cavarabd.com", "/favicon.svg")).toBe("/favicon.svg");
  });

  test("rejects protocol-relative URLs so they never escape imageBase (S5)", () => {
    for (const bad of ["//evil.com/x.png", "/\\evil.com/x.png"]) {
      for (const base of ["", "https://images.cavarabd.com"]) {
        const result = mediaUrl(base, bad);
        expect(result.startsWith("//"), `mediaUrl(${JSON.stringify(base)}, ${JSON.stringify(bad)}) -> ${result}`).toBe(
          false,
        );
        expect(result.startsWith("/\\"), `mediaUrl(${JSON.stringify(base)}, ${JSON.stringify(bad)}) -> ${result}`).toBe(
          false,
        );
        expect(result).toBe("");
      }
    }
  });

  test("returns empty string for empty or whitespace-only keys instead of a broken root URL (C5)", () => {
    expect(mediaUrl("https://images.cavarabd.com", "")).toBe("");
    expect(mediaUrl("", "")).toBe("");
    expect(mediaUrl("/media", "   ")).toBe("");
    expect(mediaUrl("https://images.cavarabd.com", "   ")).toBe("");
  });

  test("resolveCategory and snapshot resolution preserve empty category.image (C5)", () => {
    const emptyCategory: Category = {
      id: "ceramic-mugs",
      name: "Ceramic Mugs",
      description: "Hand-painted mugs",
      image: "",
      parentId: "drinkware",
      slug: "ceramic-mugs",
    };
    const whitespaceCategory: Category = {
      ...emptyCategory,
      id: "glass-mugs",
      slug: "glass-mugs",
      image: "   ",
    };

    expect(resolveCategory(emptyCategory, "https://images.cavarabd.com").image).toBe("");
    expect(resolveCategory(emptyCategory, "").image).toBe("");
    expect(resolveCategory(whitespaceCategory, "https://images.cavarabd.com").image).toBe("");

    const legacy = toLegacyCatalog(
      {
        categories: [emptyCategory, whitespaceCategory],
        products: [],
        zones: [],
        sales: [],
      },
      "https://images.cavarabd.com",
    );
    expect(legacy.categories.map((category) => category.image)).toEqual(["", ""]);
  });
});

describe("sniffImageType", () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));
  test("recognises formats by their bytes, not the file name", () => {
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, "ftypavif"))).toBe("image/avif");
  });
  test("rejects SVG, HTML and short files", () => {
    expect(sniffImageType(bytes("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffImageType(bytes("<!doctype html>"))).toBeNull();
    expect(sniffImageType(bytes(0xff))).toBeNull();
  });
});

test("contentTypeForKey", () => {
  expect(contentTypeForKey("a/b.webp")).toBe("image/webp");
  expect(contentTypeForKey("a/b.JPEG")).toBe("image/jpeg");
  expect(contentTypeForKey("a/b.svg")).toBeNull();
});

test("the public catalogue uses IMAGE_BASE_URL when set", async () => {
  const catalog = await getPublishedCatalog(createTestD1(), "https://images.cavarabd.com");
  expect(catalog.imageBase).toBe("https://images.cavarabd.com");
  const urls = [...catalog.categories.map((c) => c.image), ...catalog.products.flatMap((p) => p.variants[0].images)];
  expect(urls.every((url) => url.startsWith("https://images.cavarabd.com/product-images/"))).toBe(true);
});

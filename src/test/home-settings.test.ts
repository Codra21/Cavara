import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import {
  DEFAULT_HOME_SETTINGS,
  homeBannerSchema,
  homeSettingsSchema,
  isSafeLink,
  resolveHomeSettings,
} from "@/domain/home-settings";
import { readHomeSettings, saveHomeSettings } from "@/server/db/admin-home.repository";
import { clearHomeMemoryCache, getCachedHomeSettings, refreshHomeSettings } from "@/server/home-cache.server";
import { FakeStore } from "./helpers/catalog-doubles";
import { createTestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };

describe("home banners and editor settings (C3.3)", () => {
  test("reads default settings when empty, saves banners/sections/philosophy, and caches in R2", async () => {
    clearHomeMemoryCache();
    const db = createTestD1();
    const initial = await readHomeSettings(db);
    expect(initial.sections.map((s) => s.key)).toEqual([
      "banner",
      "featured",
      "new_arrivals",
      "collections",
      "philosophy",
      "ordering",
    ]);

    const next = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      banners: [
        {
          desktopImage: "product-images/banner-1-desktop.webp",
          mobileImage: "product-images/banner-1-mobile.webp",
          heading: "Autumn Glazes",
          buttonText: "Explore",
          linkHref: "/collections/drinkware",
          active: true,
          sort: 0,
        },
      ],
      sections: [
        { key: "banner", visible: true, heading: "" },
        { key: "new_arrivals", visible: true, heading: "Just landed" },
        { key: "featured", visible: true, heading: "Editor picks" },
        { key: "collections", visible: false, heading: "Collections" },
        { key: "philosophy", visible: true, heading: "Our craft" },
        { key: "ordering", visible: true, heading: "How to order" },
      ],
      philosophy: {
        eyebrow: "Our philosophy",
        heading: "Made to stay.",
        body: "Small-batch ceramics crafted for daily tables.",
        images: ["product-images/phil-1.webp"],
      },
    });

    const saved = await saveHomeSettings(db, owner, next);
    expect(saved.ok).toBe(true);
    expect(saved.settings.banners).toHaveLength(1);
    expect(saved.settings.sections[1]?.heading).toBe("Just landed");
    expect(saved.settings.philosophy.heading).toBe("Made to stay.");

    const store = new FakeStore();
    const sources = {
      imageBase: "",
      db: () => db,
      store,
      keys: {
        legacy: "snapshots/catalog-v1.json",
        summary: "snapshots/catalog-v4.json",
        detail: (id: number) => `snapshots/products/v2/${id}.json`,
      },
    };
    await refreshHomeSettings(sources, saved.settings);
    expect(store.objects.has("snapshots/home-v1.json")).toBe(true);

    clearHomeMemoryCache();
    const cached = await getCachedHomeSettings({
      ...sources,
      db: () => {
        throw new Error("D1 should not be called");
      },
    });
    expect(cached.banners[0]?.heading).toBe("Autumn Glazes");
  });
});

describe("home settings validation (review fixes)", () => {
  test("banner links stay on this site or use https", () => {
    for (const good of ["", "/products", "/collections/drinkware?sort=newest", "https://facebook.com/cavarabd"])
      expect(isSafeLink(good), good).toBe(true);
    for (const bad of [
      "//evil.example/sale",
      "/\\evil.example",
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://example.com",
      "https:/evil",
      "/products foo",
    ])
      expect(isSafeLink(bad), bad).toBe(false);
  });

  test("banner and philosophy pictures must be uploaded image keys", () => {
    const banner = { desktopImage: "products/home/0b9f8c1e-1234-4cde-9abc-0123456789ab.webp" };
    expect(homeBannerSchema.safeParse(banner).success).toBe(true);
    expect(homeBannerSchema.safeParse({ desktopImage: "https://evil.example/pixel.webp" }).success).toBe(false);
    expect(homeBannerSchema.safeParse({ ...banner, mobileImage: "//evil.example/x.webp" }).success).toBe(false);
    expect(
      homeSettingsSchema.safeParse({ ...DEFAULT_HOME_SETTINGS, philosophy: { images: ["/x.webp"] } }).success,
    ).toBe(false);
  });

  test("the section list holds every section exactly once", () => {
    const sections = DEFAULT_HOME_SETTINGS.sections;
    expect(homeSettingsSchema.safeParse(DEFAULT_HOME_SETTINGS).success).toBe(true);
    expect(homeSettingsSchema.safeParse({ ...DEFAULT_HOME_SETTINGS, sections: [sections[0]] }).success).toBe(false);
    const doubled = [...sections.slice(0, 5), sections[0]!];
    expect(homeSettingsSchema.safeParse({ ...DEFAULT_HOME_SETTINGS, sections: doubled }).success).toBe(false);
  });

  test("resolving drops anything that is not an image key", () => {
    const resolved = resolveHomeSettings(
      {
        ...DEFAULT_HOME_SETTINGS,
        philosophy: { ...DEFAULT_HOME_SETTINGS.philosophy, images: ["https://evil.example/a.webp"] },
      },
      "",
    );
    expect(resolved.philosophy.images).toEqual([]);
  });

  test("resolving strips unsafe banner links while preserving valid relative and https links", () => {
    const baseBanner = {
      desktopImage: "product-images/banner-1.webp",
      mobileImage: "",
      heading: "Banner",
      buttonText: "Shop",
      active: true,
      sort: 0,
    };
    const resolved = resolveHomeSettings(
      {
        ...DEFAULT_HOME_SETTINGS,
        banners: [
          { ...baseBanner, linkHref: "javascript:alert(1)" },
          { ...baseBanner, linkHref: "data:text/html,<script>alert(1)</script>" },
          { ...baseBanner, linkHref: "//evil.example/phish" },
          { ...baseBanner, linkHref: "/products" },
          { ...baseBanner, linkHref: "https://facebook.com/cavarabd" },
        ],
      },
      "",
    );
    expect(resolved.banners.map((b) => b.linkHref)).toEqual(["", "", "", "/products", "https://facebook.com/cavarabd"]);
  });
});

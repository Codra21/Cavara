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

  test("S2B-1: excludes inactive/draft banners from public snapshots and cached reads while preserving admin D1 reads", async () => {
    clearHomeMemoryCache();
    const db = createTestD1();
    const mixed = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      banners: [
        {
          desktopImage: "product-images/live-desktop.webp",
          mobileImage: "product-images/live-mobile.webp",
          heading: "Live Campaign",
          buttonText: "Shop",
          linkHref: "/collections/drinkware",
          active: true,
          sort: 0,
        },
        {
          desktopImage: "product-images/draft-desktop.webp",
          mobileImage: "product-images/draft-mobile.webp",
          heading: "Secret Unreleased Sale",
          buttonText: "Preview",
          linkHref: "/products",
          active: false,
          sort: 1,
        },
      ],
    });

    const saved = await saveHomeSettings(db, owner, mixed);
    expect(saved.settings.banners).toHaveLength(2);

    // Admin D1 reads must still see both active and inactive banners.
    const adminRead = await readHomeSettings(db);
    expect(adminRead.banners.map((b) => b.heading)).toEqual(["Live Campaign", "Secret Unreleased Sale"]);

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

    // 1. refreshHomeSettings writes only active banners to snapshots/home-v1.json and memory cache.
    await refreshHomeSettings(sources, saved.settings);
    const refreshedRaw = store.objects.get("snapshots/home-v1.json")?.json;
    expect(refreshedRaw).toBeDefined();
    const refreshedSnapshot = homeSettingsSchema.parse(JSON.parse(refreshedRaw!));
    expect(refreshedSnapshot.banners.map((b) => b.heading)).toEqual(["Live Campaign"]);
    expect(refreshedRaw).not.toContain("Secret Unreleased Sale");

    const fromMemory = await getCachedHomeSettings({
      ...sources,
      db: () => {
        throw new Error("D1 should not be called on memory hit");
      },
    });
    expect(fromMemory.banners.map((b) => b.heading)).toEqual(["Live Campaign"]);

    // 2. getCachedHomeSettings reading from D1 fallback filters inactive banners before writing R2 and returning.
    clearHomeMemoryCache();
    store.objects.clear();
    const fromD1 = await getCachedHomeSettings(sources);
    expect(fromD1.banners.map((b) => b.heading)).toEqual(["Live Campaign"]);

    const d1SnapshotRaw = store.objects.get("snapshots/home-v1.json")?.json;
    expect(d1SnapshotRaw).toBeDefined();
    const d1Snapshot = homeSettingsSchema.parse(JSON.parse(d1SnapshotRaw!));
    expect(d1Snapshot.banners.map((b) => b.heading)).toEqual(["Live Campaign"]);
    expect(d1SnapshotRaw).not.toContain("Secret Unreleased Sale");

    // 3. Stale R2 snapshot containing inactive banners is also filtered on public read.
    clearHomeMemoryCache();
    store.seed("snapshots/home-v1.json", JSON.stringify(saved.settings));
    const fromStaleR2 = await getCachedHomeSettings({
      ...sources,
      db: () => {
        throw new Error("D1 should not be called on R2 hit");
      },
    });
    expect(fromStaleR2.banners.map((b) => b.heading)).toEqual(["Live Campaign"]);
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

  test("isSafeLink rejects userinfo phishing, hostless URLs, control chars, and backslash paths (S4)", () => {
    for (const good of ["", "/products", "/collections/mugs?sort=price", "https://facebook.com/cavarabd"])
      expect(isSafeLink(good), good).toBe(true);
    for (const bad of [
      "https://cavarabd.com@evil.com",
      "https://?foo",
      "/products\u0000",
      "https://example.com/\r\n",
      "/\\evil.com",
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

describe("refreshHomeSettings cache consistency (C4B-7)", () => {
  const keys = {
    legacy: "snapshots/catalog-v1.json",
    summary: "snapshots/catalog-v4.json",
    detail: (id: number) => `snapshots/products/v2/${id}.json`,
  };

  test("returns false, removes stale key, and clears memory when store.write() returns false", async () => {
    clearHomeMemoryCache();
    const db = createTestD1();
    const store = new FakeStore();
    const persisted = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      philosophy: { ...DEFAULT_HOME_SETTINGS.philosophy, heading: "Persisted Heading" },
    });
    store.seed("snapshots/home-v1.json", JSON.stringify(persisted));

    const unpersisted = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      philosophy: { ...DEFAULT_HOME_SETTINGS.philosophy, heading: "Unpersisted False Heading" },
    });

    const removed: string[] = [];
    const rejectingStore = {
      read: (key: string) => store.read(key),
      write: async () => false,
      remove: async (key: string) => {
        removed.push(key);
        await store.remove(key);
      },
    };
    const sources = { imageBase: "", db: () => db, store: rejectingStore, keys };

    const ok = await refreshHomeSettings(sources, unpersisted);
    expect(ok).toBe(false);
    expect(removed).toEqual(["snapshots/home-v1.json"]);
    expect(store.objects.has("snapshots/home-v1.json")).toBe(false);

    const cached = await getCachedHomeSettings(sources);
    expect(cached.philosophy.heading).not.toBe("Unpersisted False Heading");
  });

  test("does not poison homeMemory when store.write() and store.remove() throw", async () => {
    clearHomeMemoryCache();
    const db = createTestD1();
    const store = new FakeStore();
    const persisted = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      philosophy: { ...DEFAULT_HOME_SETTINGS.philosophy, heading: "Persisted R2 Heading" },
    });
    store.seed("snapshots/home-v1.json", JSON.stringify(persisted));

    const unpersisted = homeSettingsSchema.parse({
      ...DEFAULT_HOME_SETTINGS,
      philosophy: { ...DEFAULT_HOME_SETTINGS.philosophy, heading: "Unpersisted Throw Heading" },
    });

    const throwingStore = {
      read: (key: string) => store.read(key),
      write: async () => {
        throw new Error("R2 write failed");
      },
      remove: async () => {
        throw new Error("R2 remove failed");
      },
    };
    const sources = { imageBase: "", db: () => db, store: throwingStore, keys };

    const ok = await refreshHomeSettings(sources, unpersisted);
    expect(ok).toBe(false);

    const cached = await getCachedHomeSettings({
      ...sources,
      db: () => {
        throw new Error("D1 should not be called");
      },
    });
    expect(cached.philosophy.heading).toBe("Persisted R2 Heading");
  });
});

import { describe, expect, test } from "bun:test";
import type { AdminIdentity } from "@/domain/admin";
import { DEFAULT_HOME_SETTINGS, homeSettingsSchema } from "@/domain/home-settings";
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
      keys: { legacy: "snapshots/catalog-v1.json", summary: "snapshots/catalog-v4.json", detail: (id: number) => `snapshots/products/v2/${id}.json` },
    };
    await refreshHomeSettings(sources, saved.settings);
    expect(store.objects.has("snapshots/home-v1.json")).toBe(true);

    clearHomeMemoryCache();
    const cached = await getCachedHomeSettings({ ...sources, db: () => { throw new Error("D1 should not be called"); } });
    expect(cached.banners[0]?.heading).toBe("Autumn Glazes");
  });
});

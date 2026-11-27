// Pure domain shapes and validation for the home page banners and section editor (C3.3 / #1, 1b). No React, no D1.
import { z } from "zod";
import { isImageKey, mediaUrl } from "./media";

export const MAX_HOME_BANNERS = 5;

export const HOME_SECTION_KEYS = [
  "banner",
  "featured",
  "new_arrivals",
  "collections",
  "philosophy",
  "ordering",
] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  banner: "Banner",
  featured: "Featured",
  new_arrivals: "New arrivals",
  collections: "Collections",
  philosophy: "Our philosophy",
  ordering: "How to order",
};

/**
 * A banner link: a path on this site ("/products", but never "//host" or "/\host", which browsers read as another
 * site) or an https:// address. Anything else, javascript: and data: included, is refused.
 */
export function isSafeLink(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("/")) return !/^\/[/\\]/.test(value) && !/[\s\\]/.test(value);
  return /^https:\/\/[^\s/\\]+(?:[/?#][^\s\\]*)?$/i.test(value);
}

const safeLinkSchema = z
  .string()
  .trim()
  .max(300)
  .refine(isSafeLink, "Links must be a path on this site (starting with one /) or an https:// address");

/** Home images are R2 keys from the upload, resolved with mediaUrl; no outside image addresses. */
const imageKeySchema = z
  .string()
  .trim()
  .max(300)
  .refine(isImageKey, "Upload the picture instead of pasting an address");

export const homeBannerSchema = z.object({
  id: z.number().int().positive().nullable().optional(),
  desktopImage: z.string().trim().min(1, "Add a desktop image").pipe(imageKeySchema),
  mobileImage: z.union([z.literal(""), imageKeySchema]).default(""),
  heading: z.string().trim().max(160).default(""),
  buttonText: z.string().trim().max(60).default(""),
  linkHref: safeLinkSchema.default("/products"),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(100).default(0),
});

export type HomeBanner = z.output<typeof homeBannerSchema>;

export const homeSectionConfigSchema = z.object({
  key: z.enum(HOME_SECTION_KEYS),
  visible: z.boolean().default(true),
  heading: z.string().trim().max(120).default(""),
});

export type HomeSectionConfig = z.output<typeof homeSectionConfigSchema>;

/** The live home page's copy before the editor existed, so a fresh install shows the same section. */
export const PHILOSOPHY_HEADING = "Your home is a personal gallery of your journey.";
export const PHILOSOPHY_BODY =
  "We explore the globe to bring you inspiring home decor, exquisite ceramics, and premium kitchenware — pieces that turn ordinary moments into small rituals.";

export const philosophyConfigSchema = z.object({
  eyebrow: z.string().trim().max(80).default("Our philosophy"),
  heading: z.string().trim().max(160).default(PHILOSOPHY_HEADING),
  body: z.string().trim().max(1200).default(PHILOSOPHY_BODY),
  /** Up to two pictures (the section shows two); empty keeps the original pair. */
  images: z.array(imageKeySchema).max(2).default([]),
});

export type PhilosophyConfig = z.output<typeof philosophyConfigSchema>;

export const homeSettingsSchema = z.object({
  banners: z.array(homeBannerSchema).max(MAX_HOME_BANNERS, `At most ${MAX_HOME_BANNERS} banners`),
  // Every section exactly once: order comes from the array, hiding from `visible`.
  sections: z
    .array(homeSectionConfigSchema)
    .length(HOME_SECTION_KEYS.length)
    .refine(
      (sections) => new Set(sections.map((section) => section.key)).size === HOME_SECTION_KEYS.length,
      "Each home section must appear once",
    ),
  philosophy: philosophyConfigSchema,
});

export type HomeSettings = z.output<typeof homeSettingsSchema>;

export const DEFAULT_HOME_SETTINGS: HomeSettings = {
  banners: [],
  sections: [
    { key: "banner", visible: true, heading: "" },
    { key: "featured", visible: true, heading: "Featured" },
    { key: "new_arrivals", visible: true, heading: "New arrivals" },
    { key: "collections", visible: true, heading: "Collections" },
    { key: "philosophy", visible: true, heading: "Our philosophy" },
    { key: "ordering", visible: true, heading: "How to order" },
  ],
  philosophy: {
    eyebrow: "Our philosophy",
    heading: PHILOSOPHY_HEADING,
    body: PHILOSOPHY_BODY,
    images: [],
  },
};

export function resolveHomeSettings(settings: HomeSettings, imageBase: string): HomeSettings {
  // Stored values were validated on save; a row edited by hand that is not an image key is dropped, not served.
  const resolveImg = (value: string) => (value && isImageKey(value) ? mediaUrl(imageBase, value) : "");
  return {
    banners: settings.banners.map((banner) => ({
      ...banner,
      desktopImage: resolveImg(banner.desktopImage),
      mobileImage: resolveImg(banner.mobileImage || banner.desktopImage),
    })),
    sections: settings.sections,
    philosophy: {
      ...settings.philosophy,
      images: settings.philosophy.images.map(resolveImg).filter(Boolean),
    },
  };
}

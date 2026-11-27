// Pure domain shapes and validation for the home page banners and section editor (C3.3 / #1, 1b). No React, no D1.
import { z } from "zod";
import { mediaUrl } from "./media";

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

const safeLinkSchema = z
  .string()
  .trim()
  .max(300)
  .refine(
    (value) => value === "" || value.startsWith("/") || /^https?:\/\//i.test(value),
    "Links must start with / or https://",
  );

export const homeBannerSchema = z.object({
  id: z.number().int().positive().nullable().optional(),
  desktopImage: z.string().trim().min(1, "Add a desktop image").max(300),
  mobileImage: z.string().trim().max(300).default(""),
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

export const philosophyConfigSchema = z.object({
  eyebrow: z.string().trim().max(80).default("Our philosophy"),
  heading: z.string().trim().max(160).default("Quiet pieces for everyday rituals."),
  body: z
    .string()
    .trim()
    .max(1200)
    .default(
      "Every cup, plate and jar in Cavara is chosen for its glaze, weight and how it feels in the hand. We keep collections small and restock only the pieces people live with daily.",
    ),
  images: z.array(z.string().trim().max(300)).max(4).default([]),
});

export type PhilosophyConfig = z.output<typeof philosophyConfigSchema>;

export const homeSettingsSchema = z.object({
  banners: z.array(homeBannerSchema).max(MAX_HOME_BANNERS, `At most ${MAX_HOME_BANNERS} banners`),
  sections: z.array(homeSectionConfigSchema).min(1).max(HOME_SECTION_KEYS.length),
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
    heading: "Quiet pieces for everyday rituals.",
    body: "Every cup, plate and jar in Cavara is chosen for its glaze, weight and how it feels in the hand. We keep collections small and restock only the pieces people live with daily.",
    images: [],
  },
};

export function resolveHomeSettings(settings: HomeSettings, imageBase: string): HomeSettings {
  const resolveImg = (value: string) => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
    return mediaUrl(imageBase, value);
  };
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

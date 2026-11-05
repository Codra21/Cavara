import type { Palette } from "./types";

export const SITE_URL = "https://cavarabd.com";
export const SITE_TITLE = "Cavara — Premium Home Decor & Accessories";
export const SITE_DESCRIPTION =
  "Shop Cavara for curated premium home decor in Bangladesh: hand-painted ceramic cups, sculptural serveware, kitchen storage and thoughtful home accessories.";
export const SHARE_DESCRIPTION = "Curated ceramics, serveware and home accessories for modern Bangladeshi homes.";

export const WHATSAPP_NUMBER = "8801788404459";
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;
export const WHATSAPP_DISPLAY = "+880 1788-404459";
export const MESSENGER_URL = "https://m.me/cavarabd";
export const FACEBOOK_URL = "https://www.facebook.com/cavarabd";
export const CONTACT_EMAIL = "forhadmazhar@gmail.com";

export const STORAGE_KEYS = {
  bag: "cavara-bag-v1",
  palette: "cavara-palette",
  recent: "cavara-recent-v1",
} as const;

export const MAX_QTY = 20;
export const RECENT_LIMIT = 8;
export const SHOP_PAGE_SIZE = 8;
export const SLIDE_INTERVAL = 6500;

export const HERO_SLIDES = [
  { id: 2, eyebrow: "Breakfast, slowly", title: "A cup and plate made for one good morning.", word: "morning" },
  { id: 21, eyebrow: "Hand-decorated kitchen", title: "Bottles that earn their place on the counter.", word: "kitchen" },
  { id: 5, eyebrow: "Sculptural serveware", title: "Soft-edged dishes in four glazes.", word: "glazes" },
];

export const PROMO_PRODUCT_ID = 10;
export const CAROUSEL_CATEGORY = "drinkware";

export const LOOKBOOK = {
  productId: 5,
  image: "/product-images/jba-oct/jba-yellow1.webp",
  spots: [
    { variant: 1, x: 50, y: 13 },
    { variant: 3, x: 21, y: 29 },
    { variant: 2, x: 89, y: 32 },
    { variant: 0, x: 79, y: 63 },
  ],
};

export const PALETTES: [Palette, ...Palette[]] = [
  { id: "teal", name: "Cavara Teal", note: "Porcelain and logo teal", colors: ["#F7F4EF", "#224D4B", "#454547"], theme: "#F7F4EF" },
  { id: "terracotta", name: "Terracotta", note: "Fired clay and warm linen", colors: ["#F6EFE7", "#9B472A", "#3B2F2A"], theme: "#F6EFE7" },
  { id: "sage", name: "Sage", note: "Soft botanical greens", colors: ["#F0F2EA", "#4B6845", "#394038"], theme: "#F0F2EA" },
  { id: "blush", name: "Blush", note: "Rose porcelain and plum", colors: ["#F9F1F0", "#8A4155", "#4A3D42"], theme: "#F9F1F0" },
  { id: "indigo", name: "Indigo Glaze", note: "Blue-and-white ceramic", colors: ["#F2F4F7", "#2B4A85", "#3D4352"], theme: "#F2F4F7" },
  { id: "midnight", name: "Midnight", note: "Dark, low-light evenings", colors: ["#101716", "#8FCDB9", "#EEF1EC"], theme: "#101716" },
];

export const NAV_LINKS = [
  { hash: "shop", label: "Shop" },
  { hash: "collections", label: "Collections" },
  { hash: "story", label: "Our story" },
  { hash: "ordering", label: "How to order" },
  { hash: "contact", label: "Contact" },
];

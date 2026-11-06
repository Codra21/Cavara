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
  theme: "cavara-theme",
  recent: "cavara-recent-v1",
} as const;

export const MAX_QTY = 20;
export const RECENT_LIMIT = 8;
export const SHOP_PAGE_SIZE = 8;
export const SLIDE_INTERVAL = 6500;

export const HERO_SLIDES = [
  { id: 2, eyebrow: "Breakfast, slowly", title: "A cup and plate made for one good morning.", word: "morning" },
  {
    id: 21,
    eyebrow: "Hand-decorated kitchen",
    title: "Bottles that earn their place on the counter.",
    word: "kitchen",
  },
  { id: 5, eyebrow: "Sculptural serveware", title: "Soft-edged dishes in four glazes.", word: "glazes" },
];

export const PROMO_PRODUCT_ID = 10;
export const CAROUSEL_CATEGORY = "drinkware";

export const LOOKBOOK = {
  productId: 5,
  /** R2 key; resolve with mediaUrl(). */
  image: "product-images/jba-oct/jba-yellow1.webp",
  spots: [
    { variant: 1, x: 50, y: 13 },
    { variant: 3, x: 21, y: 29 },
    { variant: 2, x: 89, y: 32 },
    { variant: 0, x: 79, y: 63 },
  ],
};

export const NAV_LINKS = [
  { hash: "shop", label: "Shop" },
  { hash: "collections", label: "Collections" },
  { hash: "story", label: "Our story" },
  { hash: "ordering", label: "How to order" },
  { hash: "contact", label: "Contact" },
];

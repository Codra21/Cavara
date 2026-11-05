export type CategoryId = "drinkware" | "serveware" | "kitchen-storage" | "home-accessories";

export interface Category {
  id: CategoryId;
  name: string;
  description: string;
  image: string;
}

export interface Variant {
  name: string;
  /** Any CSS background value: a colour, gradient or conic gradient. */
  swatch: string;
  images: string[];
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  category: CategoryId;
  price: number;
  summary: string;
  details?: string[];
  note?: string;
  variants: [Variant, ...Variant[]];
}

export interface BagItem {
  id: number;
  variant: number;
  qty: number;
}

export interface Palette {
  id: string;
  name: string;
  note: string;
  colors: [string, string, string];
  theme: string;
}

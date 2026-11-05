/** Category ids come from D1 (e.g. "drinkware"). */
export type CategoryId = string;

export type Availability = "in_stock" | "out_of_stock" | "preorder";

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
  /** Stock state for this colour. Optional so the seed source can omit it (defaults to in_stock). */
  availability?: Availability;
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

/** Published catalogue as read from D1, in display order. */
export interface Catalog {
  categories: Category[];
  products: Product[];
}

export interface BagItem {
  id: number;
  variant: number;
  qty: number;
}

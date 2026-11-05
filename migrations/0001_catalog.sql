-- Catalogue schema: categories, products, colour variants and their images.
-- Money is whole BDT (integer). cost_price is Owner-only and never returned by public reads.
-- product_variants.position is the variant index the storefront and saved bags use (0 = default colour).

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories (id),
  summary TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  note TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  regular_price INTEGER CHECK (regular_price IS NULL OR regular_price > 0),
  cost_price INTEGER CHECK (cost_price IS NULL OR cost_price >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_products_status_sort ON products (status, sort);
CREATE INDEX idx_products_category ON products (category_id);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  name TEXT NOT NULL,
  swatch TEXT NOT NULL, -- any CSS background value
  availability TEXT NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock', 'out_of_stock', 'preorder')),
  UNIQUE (product_id, position)
);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  path TEXT NOT NULL,
  alt TEXT,
  UNIQUE (variant_id, position)
);

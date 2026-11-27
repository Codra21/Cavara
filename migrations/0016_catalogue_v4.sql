-- Batch C2.1: weight-based delivery, new arrival flag, subcategories with slug redirects, and per-kg delivery charge.

ALTER TABLE products ADD COLUMN weight_g INTEGER CHECK (weight_g IS NULL OR (typeof(weight_g) = 'integer' AND weight_g BETWEEN 1 AND 100000));
ALTER TABLE products ADD COLUMN new_arrival INTEGER NOT NULL DEFAULT 0 CHECK (new_arrival IN (0, 1));

ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories (id);
ALTER TABLE categories ADD COLUMN slug TEXT;
UPDATE categories SET slug = id WHERE slug IS NULL;
CREATE UNIQUE INDEX idx_categories_slug ON categories (slug);
ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));

CREATE TABLE category_slugs (
  old_slug TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE delivery_zones ADD COLUMN per_kg_charge INTEGER NOT NULL DEFAULT 20 CHECK (typeof(per_kg_charge) = 'integer' AND per_kg_charge BETWEEN 0 AND 100000);
ALTER TABLE orders ADD COLUMN total_weight_g INTEGER NOT NULL DEFAULT 0 CHECK (typeof(total_weight_g) = 'integer' AND total_weight_g >= 0);

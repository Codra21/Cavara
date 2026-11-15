-- P9.2: shop-wide, category and product sales (P9.3 adds coupons to the same table). Backwards compatible with the
-- code already live: the live code never reads these, and the two new order_items columns are nullable, so its order
-- inserts keep working. A NULL list_price means the line was charged the price it was listed at.
--
-- kind 'sale' is an automatic discount: scope says what it covers (every product, one category, one product), and the
-- best one for a product wins. kind 'coupon' (P9.3) uses code, min_order, max_discount, usage_limit and used_count;
-- until then nothing writes those columns. Money is integer BDT. A percent value is 1 to 100; the sale form allows
-- 1 to 99. Times are ISO 8601 UTC with milliseconds (`YYYY-MM-DDTHH:MM:SS.sssZ`), so comparing them as text is safe.
-- No foreign keys, and rows are never deleted (an order's discount_id must keep pointing at its row); the Owner
-- switches a discount off with `active = 0`.
CREATE TABLE discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'coupon')),
  scope TEXT NOT NULL CHECK (scope IN ('all', 'category', 'product')),
  category_id TEXT,
  product_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('percent', 'amount')),
  value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value > 0),
  starts_at TEXT NOT NULL,
  -- NULL = no end date.
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Optimistic lock for the admin form: random per save.
  revision TEXT NOT NULL,
  -- Coupon columns (P9.3).
  code TEXT UNIQUE,
  min_order INTEGER CHECK (min_order IS NULL OR min_order >= 0),
  max_discount INTEGER CHECK (max_discount IS NULL OR max_discount > 0),
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  CHECK (type <> 'percent' OR value <= 100),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (scope = 'all' AND category_id IS NULL AND product_id IS NULL)
    OR (scope = 'category' AND category_id IS NOT NULL AND product_id IS NULL)
    OR (scope = 'product' AND product_id IS NOT NULL AND category_id IS NULL)
  )
);

-- Checkout and the snapshot read the sales that are on or still to come: active, and either open-ended or ending in
-- the future. `ends_at IS NULL OR ends_at > ?` becomes two range probes on this index (NULL sorts first), so sales
-- that already ended are never walked, however many pile up. The partial WHERE must match the query's text.
CREATE INDEX idx_discounts_live ON discounts (ends_at) WHERE kind = 'sale' AND active = 1;

-- The admin list of sales, newest first. Partial on kind (not a kind column) so the planner does not pick it for the
-- live query above; P9.3 adds the same for coupons.
CREATE INDEX idx_discounts_admin ON discounts (created_at DESC, id DESC) WHERE kind = 'sale';

-- What the Owner sees on an order: the price the piece was listed at, and the sale that took the difference.
ALTER TABLE order_items ADD COLUMN list_price INTEGER CHECK (list_price IS NULL OR list_price > 0);
ALTER TABLE order_items ADD COLUMN discount_id INTEGER;

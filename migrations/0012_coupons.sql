-- P9.3: checkout coupons. The coupon rows live in `discounts` (kind 'coupon', columns from 0011). This migration only
-- adds what an order records about the coupon it used. Backwards compatible with the code already live: every new
-- column is nullable or defaulted, so its order inserts keep working, and the live code never reads them.
--
-- `orders.total = subtotal + delivery_charge` is CHECKed (0006) and cannot be altered without a table rebuild, so
-- `subtotal` becomes the item total AFTER the coupon, and `items_total` keeps it before: items_total - coupon_discount
-- = subtotal. Revenue and profit follow `subtotal`. A NULL items_total means the order predates coupons.
-- No foreign key on coupon_id (as discount_id on order_items): coupon rows are never deleted, and archiving must not
-- block an order. coupon_code is a snapshot, so a later edit of the coupon never changes a placed order.
ALTER TABLE orders ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0 CHECK (coupon_discount >= 0);
ALTER TABLE orders ADD COLUMN items_total INTEGER
  CHECK (items_total IS NULL OR (items_total > 0 AND items_total - coupon_discount = subtotal));
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN coupon_id INTEGER;

-- The admin list of coupons, newest first (the sales list has the same index on kind 'sale'). Lookups by code use the
-- UNIQUE index on discounts.code.
CREATE INDEX idx_discounts_admin_coupons ON discounts (created_at DESC, id DESC) WHERE kind = 'coupon';

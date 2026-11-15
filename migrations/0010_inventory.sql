-- P9.1: stock counts and a movement ledger. Backwards compatible with the code already live: the live code never
-- reads or writes these, and a NULL stock leaves a colour's manual availability exactly as it is today.
--
-- product_variants.stock: NULL means "not counted" (the Owner sets availability by hand). A number means counted:
-- every write that changes it also sets availability (out_of_stock at 0 or below, in_stock above 0; a colour set to
-- preorder stays preorder and may go below 0 for back-orders).
ALTER TABLE product_variants ADD COLUMN stock INTEGER;

-- One row per change to a counted colour. A colour is named by variant_id, not by position: product saves renumber
-- positions (they park at +1000), while the row id of a kept colour never changes. variant_name is a snapshot, so the
-- history still reads right after a colour is renamed or removed. No foreign keys, so removing a colour or product
-- never blocks on, or rewrites, its history.
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL
    CHECK (reason IN ('stock_in', 'stock_out', 'order', 'order_cancel', 'order_reopen', 'correction')),
  order_id TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  -- NULL for a shopper's order.
  actor_username TEXT,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- A product's history, newest first, by keyset.
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, created_at DESC, id DESC);
-- What an order took, per colour, for cancel and reopen. Partial: most rows (stock in and out) have no order.
CREATE INDEX idx_stock_movements_order ON stock_movements (order_id, variant_id) WHERE order_id IS NOT NULL;

-- "Low stock" in the admin product list: a counted colour with 3 or fewer. Partial and tiny, like
-- idx_variants_out_of_stock. The list query repeats these literals so SQLite can use it.
CREATE INDEX idx_variants_low_stock ON product_variants (product_id) WHERE stock IS NOT NULL AND stock <= 3;

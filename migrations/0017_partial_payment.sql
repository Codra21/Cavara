-- Batch C3.2 (#18): rebuild orders to add the 'partially_paid' payment status, amount_paid and payment_method.
--
-- D1 always enforces foreign keys and a migration cannot turn them off. order_items, order_status_history and
-- order_notification_outbox reference orders (id) ON DELETE RESTRICT, so dropping a populated orders table fails at
-- COMMIT even with defer_foreign_keys (checked on local D1, 2026-11-28). The three children are therefore rebuilt
-- in the same migration: new copies point at orders_next, the old children go first, then the old orders, and the
-- renames rewrite every reference back to "orders". Columns, CHECKs, defaults, AUTOINCREMENT ids and indexes are
-- recreated exactly as 0006, 0008, 0011, 0012, 0013, 0014 and 0016 left them.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE orders_next (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 2 AND 80),
  phone TEXT NOT NULL CHECK (length(phone) = 11),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 8 AND 300),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  zone_id TEXT NOT NULL REFERENCES delivery_zones (id),
  zone_name TEXT NOT NULL,
  delivery_charge INTEGER NOT NULL CHECK (typeof(delivery_charge) = 'integer' AND delivery_charge >= 0),
  subtotal INTEGER NOT NULL CHECK (typeof(subtotal) = 'integer' AND subtotal > 0),
  total INTEGER NOT NULL CHECK (total = subtotal + delivery_charge),
  item_count INTEGER NOT NULL CHECK (item_count >= 1),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'confirmed', 'dispatched', 'delivered', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'refunded')),
  -- What the shop has received. Tied to payment_status: unpaid 0, partially paid strictly between 0 and the total,
  -- paid the total; a refunded order keeps what was received (0 to the total).
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(amount_paid) = 'integer' AND amount_paid BETWEEN 0 AND total AND (
      (payment_status = 'unpaid' AND amount_paid = 0)
      OR (payment_status = 'partially_paid' AND amount_paid > 0 AND amount_paid < total)
      OR (payment_status = 'paid' AND amount_paid = total)
      OR payment_status = 'refunded'
    )
  ),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('bkash', 'nagad', 'cash')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  shop_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  dispatched_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  change_token TEXT NOT NULL DEFAULT '',
  coupon_discount INTEGER NOT NULL DEFAULT 0 CHECK (coupon_discount >= 0),
  items_total INTEGER
    CHECK (items_total IS NULL OR (items_total > 0 AND items_total - coupon_discount = subtotal)),
  coupon_code TEXT,
  coupon_id INTEGER,
  coupon_returned INTEGER NOT NULL DEFAULT 0 CHECK (coupon_returned IN (0, 1)),
  total_weight_g INTEGER NOT NULL DEFAULT 0 CHECK (typeof(total_weight_g) = 'integer' AND total_weight_g >= 0)
);

INSERT INTO orders_next (
  id, reference, idempotency_key, payload_hash, customer_name, phone, address, note,
  zone_id, zone_name, delivery_charge, subtotal, total, item_count, status, payment_status,
  amount_paid, payment_method, version, shop_day, created_at, updated_at,
  confirmed_at, dispatched_at, delivered_at, cancelled_at, change_token,
  coupon_discount, items_total, coupon_code, coupon_id, coupon_returned, total_weight_g
)
SELECT
  id, reference, idempotency_key, payload_hash, customer_name, phone, address, note,
  zone_id, zone_name, delivery_charge, subtotal, total, item_count, status, payment_status,
  CASE WHEN payment_status IN ('paid', 'refunded') THEN total ELSE 0 END,
  NULL,
  version, shop_day, created_at, updated_at,
  confirmed_at, dispatched_at, delivered_at, cancelled_at, change_token,
  coupon_discount, items_total, coupon_code, coupon_id, coupon_returned, total_weight_g
FROM orders;

CREATE TABLE order_items_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders_next (id) ON DELETE RESTRICT,
  line INTEGER NOT NULL CHECK (line >= 0),
  -- No foreign key to products: an archived or edited product must never block or change a placed order.
  product_id INTEGER NOT NULL,
  variant_position INTEGER NOT NULL CHECK (variant_position >= 0),
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('in_stock', 'preorder')),
  unit_price INTEGER NOT NULL CHECK (typeof(unit_price) = 'integer' AND unit_price > 0),
  -- Snapshot of the Owner-only cost price at order time; NULL when it was not set. Never sent to the shop.
  cost_price INTEGER CHECK (cost_price IS NULL OR cost_price >= 0),
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  line_total INTEGER NOT NULL CHECK (line_total = unit_price * qty),
  list_price INTEGER CHECK (list_price IS NULL OR list_price > 0),
  discount_id INTEGER,
  UNIQUE (order_id, line)
);
INSERT INTO order_items_next (
  id, order_id, line, product_id, variant_position, product_name, variant_name, availability, unit_price, cost_price,
  qty, line_total, list_price, discount_id
)
SELECT
  id, order_id, line, product_id, variant_position, product_name, variant_name, availability, unit_price, cost_price,
  qty, line_total, list_price, discount_id
FROM order_items;

CREATE TABLE order_status_history_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders_next (id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_payment_status TEXT,
  to_payment_status TEXT NOT NULL,
  -- NULL for the customer's own submission.
  actor_username TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_at TEXT NOT NULL
);
INSERT INTO order_status_history_next (
  id, order_id, from_status, to_status, from_payment_status, to_payment_status, actor_username, note, created_at
)
SELECT id, order_id, from_status, to_status, from_payment_status, to_payment_status, actor_username, note, created_at
FROM order_status_history;

CREATE TABLE order_notification_outbox_next (
  order_id TEXT PRIMARY KEY REFERENCES orders_next (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Unix milliseconds.
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO order_notification_outbox_next (
  order_id, status, attempts, next_attempt_at, lease_until, last_error, sent_at, created_at, updated_at
)
SELECT order_id, status, attempts, next_attempt_at, lease_until, last_error, sent_at, created_at, updated_at
FROM order_notification_outbox;

-- Children first, so nothing references the old orders when it goes.
DROP TABLE order_notification_outbox;
DROP TABLE order_status_history;
DROP TABLE order_items;
DROP TABLE orders;

-- Renaming orders_next rewrites the *_next tables' references to "orders".
ALTER TABLE orders_next RENAME TO orders;
ALTER TABLE order_items_next RENAME TO order_items;
ALTER TABLE order_status_history_next RENAME TO order_status_history;
ALTER TABLE order_notification_outbox_next RENAME TO order_notification_outbox;

CREATE INDEX idx_orders_created ON orders (created_at DESC, id DESC);
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC, id DESC);
CREATE INDEX idx_orders_phone ON orders (phone, created_at DESC);
CREATE INDEX idx_orders_phone_new ON orders (phone) WHERE status = 'new';

CREATE INDEX idx_order_history_order ON order_status_history (order_id, id);
CREATE INDEX idx_outbox_pending ON order_notification_outbox (next_attempt_at) WHERE status = 'pending';
-- A sender that crashed mid-send leaves a 'sending' row; its lease expiry makes it due again.
CREATE INDEX idx_outbox_sending ON order_notification_outbox (lease_until) WHERE status = 'sending';
CREATE INDEX idx_outbox_failed ON order_notification_outbox (created_at) WHERE status = 'failed';

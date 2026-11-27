-- Batch C3.2 (#18): Rebuild orders table to add 'partially_paid' payment status, amount_paid, and payment_method.
-- Uses PRAGMA defer_foreign_keys = ON so child tables (order_items, order_status_history, order_notification_outbox)
-- keep their foreign key references intact across the table swap.

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
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (typeof(amount_paid) = 'integer' AND amount_paid >= 0),
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
  CASE WHEN payment_status = 'paid' THEN total ELSE 0 END,
  NULL,
  version, shop_day, created_at, updated_at,
  confirmed_at, dispatched_at, delivered_at, cancelled_at, change_token,
  coupon_discount, items_total, coupon_code, coupon_id, coupon_returned, total_weight_g
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_next RENAME TO orders;

CREATE INDEX idx_orders_created ON orders (created_at DESC, id DESC);
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC, id DESC);
CREATE INDEX idx_orders_phone ON orders (phone, created_at DESC);
CREATE INDEX idx_orders_phone_new ON orders (phone) WHERE status = 'new';

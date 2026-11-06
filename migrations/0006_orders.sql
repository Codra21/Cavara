-- Unit 7: delivery zones, guest orders, status history, order rate limits and per-day totals.
-- Money is whole BDT. Orders keep snapshots (names, prices, cost prices, delivery charge) so later catalogue or zone
-- edits never change a placed order. Every admin filter has an index (code-standards: D1 read budget).

CREATE TABLE delivery_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  charge INTEGER NOT NULL CHECK (typeof(charge) = 'integer' AND charge BETWEEN 0 AND 100000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Starting charges from the Owner (2026-11-06). Editable from the admin.
INSERT INTO delivery_zones (id, name, charge, sort) VALUES
  ('inside-dhaka', 'Inside Dhaka', 80, 0),
  ('outside-dhaka', 'Outside Dhaka', 150, 1);

CREATE TABLE orders (
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
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Asia/Dhaka calendar day the order was placed (YYYY-MM-DD), the key for daily_totals.
  shop_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  dispatched_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX idx_orders_created ON orders (created_at DESC, id DESC);
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC, id DESC);
CREATE INDEX idx_orders_phone ON orders (phone, created_at DESC);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
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
  UNIQUE (order_id, line)
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_payment_status TEXT,
  to_payment_status TEXT NOT NULL,
  -- NULL for the customer's own submission.
  actor_username TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_order_history_order ON order_status_history (order_id, id);

-- Submission limits, keyed by HMAC so raw IPs and phone numbers are not stored (as admin_login_limits).
CREATE TABLE order_rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_order_rate_limits_expires ON order_rate_limits (expires_at);

-- One row per Asia/Dhaka day, updated in the same batch as the order write or status change, so the dashboard
-- reads a few rows instead of summing orders (unit 8). Sales (revenue, profit) count orders that are confirmed,
-- dispatched or delivered, on the day the order was placed; cancelling a sold order takes it back out.
-- Revenue is the item subtotal (delivery charges are passed on, not revenue). Profit = Σ (unit_price − cost_price) × qty.
CREATE TABLE daily_totals (
  shop_day TEXT PRIMARY KEY,
  orders_received INTEGER NOT NULL DEFAULT 0,
  orders_sold INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  -- Sold order lines without a cost price, so the dashboard can say the profit is incomplete.
  lines_without_cost INTEGER NOT NULL DEFAULT 0
);

-- Unit 8: Telegram order alerts. Each order gets one outbox row in the same batch that saves the order, so an alert
-- is never lost and never blocks an order. Delivery is tried right after the save and retried by the 5-minute cron.
-- Partial indexes keep the cron's lookups at ~0 rows read when nothing is waiting (code-standards: D1 read budget).
CREATE TABLE order_notification_outbox (
  order_id TEXT PRIMARY KEY REFERENCES orders (id) ON DELETE RESTRICT,
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

CREATE INDEX idx_outbox_pending ON order_notification_outbox (next_attempt_at) WHERE status = 'pending';
-- A sender that crashed mid-send leaves a 'sending' row; its lease expiry makes it due again.
CREATE INDEX idx_outbox_sending ON order_notification_outbox (lease_until) WHERE status = 'sending';
CREATE INDEX idx_outbox_failed ON order_notification_outbox (created_at) WHERE status = 'failed';

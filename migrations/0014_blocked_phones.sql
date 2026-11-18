-- Fake-order limits (P10.5, docs/abuse-defense-plan.md Layer 4). Backwards compatible with the code already live: a new
-- table and a new index, nothing the live code reads or writes.
--
-- blocked_phones: numbers the Owner has blocked. phone is stored the way orders store it (normalised 01XXXXXXXXX), so
-- the order insert checks it by primary key. An order from a blocked number is refused and nothing is saved. Blocking
-- does not cancel the number's existing orders. A row is deleted to unblock (the audit log keeps the history).
CREATE TABLE blocked_phones (
  phone TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- Newest first for the admin list, so the page needs no sort step.
CREATE INDEX idx_blocked_phones_created ON blocked_phones (created_at DESC, phone);

-- Open-order cap: the order insert counts a phone's orders still 'new'. This partial index holds only those rows, so the
-- count reads at most the cap's worth of entries and never walks the phone's history.
CREATE INDEX idx_orders_phone_new ON orders (phone) WHERE status = 'new';

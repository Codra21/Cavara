-- Unit 7b: optimistic locking for order status changes. Each change claims the order with
-- `UPDATE … WHERE id = ? AND version = ?`, sets a fresh random change_token, and guards every other statement in
-- the batch (history, daily totals, audit) on that token. A version number alone is not enough: two stale saves
-- expect the same version, and the loser's guarded statements would match the winner's new version.
ALTER TABLE orders ADD COLUMN change_token TEXT NOT NULL DEFAULT '';

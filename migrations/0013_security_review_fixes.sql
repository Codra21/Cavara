-- Security review fixes (2026-11-15). Backwards compatible with the code already live: every new column is defaulted,
-- so its inserts keep working, and the live code never reads them.
--
-- count_epoch: goes up each time counting stops for a colour (stopCounting). A stock movement records the epoch it was
-- written in, and a cancel or reopen only moves the movements of the colour's current epoch. Without it, stopping and
-- restarting a count and then cancelling an old order would return stock the new count already includes.
ALTER TABLE product_variants ADD COLUMN count_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN count_epoch INTEGER NOT NULL DEFAULT 0;

-- coupon_returned: 1 while this order has given its coupon use back (it was cancelled unpaid). Reopening claims the use
-- again and clears it, so a cancel and reopen loop can never return more uses than the order took.
ALTER TABLE orders ADD COLUMN coupon_returned INTEGER NOT NULL DEFAULT 0 CHECK (coupon_returned IN (0, 1));

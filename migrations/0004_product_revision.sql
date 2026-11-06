-- Optimistic locking for the admin product editor. Every save sets a fresh random revision and only applies when
-- the revision the editor loaded is still current, so two tabs cannot silently overwrite each other.
ALTER TABLE products ADD COLUMN revision TEXT NOT NULL DEFAULT '';

-- Indexes for the paginated admin product list (P4.1). Indexes only, so live code keeps working before and after.
-- The list filters by status and category, sorts by last update, name or price, and pages by keyset (sort key, id).
-- Every combination needs an index that starts with its equality filters and ends with the sort key and id, or SQLite
-- scans the table or builds a temp B-tree. Four indexes per sort cover none/status/category/both. Price sorts up and
-- down through one index (SQLite reads it backwards). The name index uses NOCASE, the collation of the query's ORDER BY.
-- Each index adds about one row written to a product save, not to an order or a page view.

CREATE INDEX idx_products_updated ON products (updated_at, id);
CREATE INDEX idx_products_status_updated ON products (status, updated_at, id);
CREATE INDEX idx_products_category_updated ON products (category_id, updated_at, id);
CREATE INDEX idx_products_category_status_updated ON products (category_id, status, updated_at, id);

CREATE INDEX idx_products_name ON products (name COLLATE NOCASE, id);
CREATE INDEX idx_products_status_name ON products (status, name COLLATE NOCASE, id);
CREATE INDEX idx_products_category_name ON products (category_id, name COLLATE NOCASE, id);
CREATE INDEX idx_products_category_status_name ON products (category_id, status, name COLLATE NOCASE, id);

CREATE INDEX idx_products_price ON products (price, id);
CREATE INDEX idx_products_status_price ON products (status, price, id);
CREATE INDEX idx_products_category_price ON products (category_id, price, id);
CREATE INDEX idx_products_category_status_price ON products (category_id, status, price, id);

-- "Has an out-of-stock colour". Partial, so it holds only the out-of-stock colours (a few rows) and the list checks
-- each candidate product with one probe instead of reading all of its colours.
CREATE INDEX idx_variants_out_of_stock ON product_variants (product_id) WHERE availability = 'out_of_stock';

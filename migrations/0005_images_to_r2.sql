-- Product and category images now live in R2. Stored values become object keys ("product-images/…") instead of
-- static paths ("/product-images/…"); the app builds URLs from keys (src/domain/media.ts).
-- Upload the files first (scripts/r2/upload-product-images.ts) or the storefront shows broken images.
UPDATE product_images SET path = substr(path, 2) WHERE path LIKE '/product-images/%';
UPDATE categories SET image = substr(image, 2) WHERE image LIKE '/product-images/%';

// Public catalogue server functions. Safe to import anywhere: the build replaces the handler with an RPC stub on
// the client (TanStack Start server-functions guide), so the repository and D1 never reach the browser.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { getCachedCatalog } from "@/server/catalog-cache.server";
import { AVAILABILITY_FILTERS, MAX_PAGE, MAX_PRICE, MAX_SEARCH_LENGTH, SORT_KEYS } from "@/domain/product-listing";
import {
  getCategories,
  getHome,
  getProductBySlug,
  getProductsByIds,
  getRelatedProducts,
  listProductsPage,
  MAX_IDS_PER_LOOKUP,
} from "@/server/catalog-queries.server";
import { catalogSources } from "@/server/catalog-sources.server";

/** Browsers and shared caches may keep a public answer for a minute (5 min on shared caches); saves purge the Worker's
 * own copies, so this bounds how stale a visitor can be. */
export const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=300";

/**
 * Edge-cache headers for the browser's own RPC call. During SSR the same function runs inside the page request, and
 * setResponseHeader would then put them on the HTML page, so only calls carrying Start's `x-tsr-serverFn` header get
 * them.
 */
function cacheForBrowserCalls() {
  if (getRequestHeader("x-tsr-serverFn") === "true") setResponseHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
}

/** The full v1 catalogue. No storefront code reads it any more (P3.3); it stays until the legacy snapshot is removed. */
export const getCatalogFn = createServerFn({ method: "GET" }).handler(() => getCachedCatalog(catalogSources()));

const slugText = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Slug input shared by the two per-product lookups. */
const slugInput = z.object({ slug: slugText });

/**
 * Cards for the product ids in a bag, checkout or recently-viewed list, from the summary snapshot, plus the active
 * delivery areas. Unknown or unpublished ids come back in `missing`. Input is bounded: at most 50 positive integers, duplicates dropped, sorted so that the same bag always
 * makes the same URL.
 */
export const getProductsByIdsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      ids: z
        .array(z.number().int().positive().max(2_147_483_647))
        .max(MAX_IDS_PER_LOOKUP)
        .transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
    }),
  )
  .handler(async ({ data }) => {
    const result = await getProductsByIds(catalogSources(), data.ids);
    // Only a successful answer may be cached: a thrown error still goes out as a 200 with these headers.
    cacheForBrowserCalls();
    return result;
  });

/** One product with everything the product page shows, found by slug. `product` is null for an unknown slug. */
export const getProductBySlugFn = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data }) => {
    const result = await getProductBySlug(catalogSources(), data.slug);
    // Only a successful answer may be cached: a thrown error still goes out as a 200 with these headers.
    cacheForBrowserCalls();
    return result;
  });

/** Up to four products to suggest under a product page: its category first, from the summary. */
export const getRelatedProductsFn = createServerFn({ method: "GET" })
  .validator(slugInput)
  .handler(async ({ data }) => {
    const result = await getRelatedProducts(catalogSources(), data.slug);
    // Only a successful answer may be cached: a thrown error still goes out as a 200 with these headers.
    cacheForBrowserCalls();
    return result;
  });

const listingInput = z.object({
  category: slugText.optional(),
  q: z.string().max(MAX_SEARCH_LENGTH).optional(),
  sort: z.enum(SORT_KEYS).optional(),
  min: z.number().int().min(0).max(MAX_PRICE).optional(),
  max: z.number().int().min(0).max(MAX_PRICE).optional(),
  availability: z.enum(AVAILABILITY_FILTERS).optional(),
  page: z.number().int().min(1).max(MAX_PAGE).optional(),
});

/**
 * One page (24 products) of the product listing, filtered, sorted and searched in memory over the summary
 * snapshot, with the facet counts the page uses to hide filters that offer one choice. Reads no D1.
 */
export const listProductsFn = createServerFn({ method: "GET" })
  .validator(listingInput)
  .handler(async ({ data }) => {
    const result = await listProductsPage(catalogSources(), data);
    // Only a successful answer may be cached: a thrown error still goes out as a 200 with these headers.
    cacheForBrowserCalls();
    return result;
  });

/** Categories with their image and product count: the footer links and the home page's collection tiles. */
export const getCategoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const result = await getCategories(catalogSources());
  cacheForBrowserCalls();
  return result;
});

/** Every product the home page shows (rows and hero), from the summary. */
export const getHomeFn = createServerFn({ method: "GET" }).handler(async () => {
  const result = await getHome(catalogSources());
  cacheForBrowserCalls();
  return result;
});

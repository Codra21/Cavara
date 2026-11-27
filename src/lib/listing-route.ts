// Pieces the two listing routes (`/products` and `/collections/$category`) share: the loader and the page head.
import type { QueryClient } from "@tanstack/react-query";
import { notFound, redirect } from "@tanstack/react-router";
import { isCategorySlug } from "@/domain/catalog";
import type { ListSearch } from "@/domain/product-listing";
import { listingSeo } from "@/domain/seo";
import { SHARE_DESCRIPTION, SITE_URL } from "@/lib/config";
import { listingQueryOptions } from "@/lib/query";
import { safeLoad } from "@/lib/safe-load";
import type { Category } from "@/lib/types";

/**
 * Loads the requested page of a listing. An unknown category is a 404. Returns the page count so the route can send
 * a visitor on `?page=99` to the last page.
 */
export async function loadListing(
  queryClient: QueryClient,
  category: string | undefined,
  search: ListSearch,
  /** The path this request came in on, e.g. `/collections/drinkware/mugs`. */
  requestedPath?: string,
) {
  if (category !== undefined && !isCategorySlug(category)) throw notFound();
  const query = { ...search, ...(category ? { category } : {}) };
  const page = search.page ?? 1;
  const previous =
    page > 1 ? queryClient.getQueryData(listingQueryOptions({ ...query, page: page - 1 }).queryKey) : undefined;
  const listing = await safeLoad("product listing", () => queryClient.query(listingQueryOptions(query))).catch(
    (error: unknown) => {
      // "Load more" navigates to ?page=N with page N-1 already on screen. Throwing would swap those cards for the
      // error page; the cached page keeps them, and ProductListing shows its inline "couldn't load more" and Try again.
      // A first visit to ?page=N (and the server render) has nothing cached, so it still gets the error page.
      if (previous) return previous;
      throw error;
    },
  );
  if (category !== undefined && !listing.category) throw notFound();
  // Old slugs, moved subcategories and renamed parents all resolve to the category; anything but its one path 301s.
  if (requestedPath && listing.canonicalPath && listing.canonicalPath !== requestedPath)
    throw redirect({ href: `${listing.canonicalPath}${searchString(search)}`, statusCode: 301 });
  return { category: listing.category, pageCount: listing.pageCount };
}

/** The filters as a query string, kept across a canonical redirect. */
function searchString(search: ListSearch): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Title, description, canonical (the clean path, without filters or page) and sharing tags for a listing page. */
export function listingHead(category: Category | null | undefined) {
  const seo = listingSeo(SITE_URL, category ?? null, SHARE_DESCRIPTION);
  return {
    meta: [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
      { property: "og:url", content: seo.url },
      { name: "twitter:title", content: seo.title },
      { name: "twitter:description", content: seo.description },
      ...(seo.image
        ? [
            { property: "og:image", content: seo.image },
            { name: "twitter:image", content: seo.image },
          ]
        : []),
    ],
    links: [{ rel: "canonical", href: seo.url }],
  };
}

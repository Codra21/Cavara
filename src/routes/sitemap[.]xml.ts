import { createFileRoute } from "@tanstack/react-router";
import { sitemapXml } from "@/domain/seo";
import { SITE_URL } from "@/lib/config";
import { getCachedCatalog } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";

// /sitemap.xml: the home page and every published product, from the cached catalogue (no D1 read per request).
// A product published in the admin appears here as soon as the catalogue refreshes.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const catalog = await getCachedCatalog(catalogSources());
        return new Response(sitemapXml(SITE_URL, catalog.products), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});

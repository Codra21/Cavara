import { createFileRoute } from "@tanstack/react-router";
import { sitemapXml } from "@/domain/seo";
import { SITE_URL } from "@/lib/config";
import { getCatalogSummary } from "@/server/catalog-cache.server";
import { catalogSources } from "@/server/catalog-sources.server";

// /sitemap.xml: the home page and every published product, from the cached summary (no D1 read per request).
// A product published in the admin appears here as soon as the catalogue refreshes.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const summary = await getCatalogSummary(catalogSources());
        return new Response(sitemapXml(SITE_URL, summary.products), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});

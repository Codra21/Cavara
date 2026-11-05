/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "@/styles/app.css?url";
import siteCss from "@/styles/site.css?url";
import { CONTACT_EMAIL, FACEBOOK_URL, SHARE_DESCRIPTION, SITE_DESCRIPTION, SITE_TITLE, SITE_URL, WHATSAPP_NUMBER } from "@/lib/config";
import { GlobalEffects } from "@/components/layout/GlobalEffects";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Announcement, FloatingChat, QuickDock, SiteFooter, Toast } from "@/components/layout/SiteChrome";
import { BagDrawer } from "@/components/store/BagDrawer";
import { ProductDialog } from "@/components/store/ProductDialog";
import { StoreProvider } from "@/components/store/StoreProvider";
import { THEME_BOOT, THEME_COLORS } from "@/lib/theme";

const OG_IMAGE = `${SITE_URL}/og-image.jpg`;
const OG_ALT = "Cavara logo beside hand-painted ceramic cups and a yellow serving dish";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0, viewport-fit=cover" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      {
        name: "keywords",
        content: "premium home decor Bangladesh, ceramic cups Bangladesh, serveware Dhaka, kitchen storage jars, home accessories, Cavara",
      },
      { name: "theme-color", content: THEME_COLORS.light },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Cavara" },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SHARE_DESCRIPTION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SHARE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: OG_ALT },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Cavara",
          alternateName: "Cavarabd",
          url: `${SITE_URL}/`,
          logo: `${SITE_URL}/assets/brand/cavara-logo.png`,
          sameAs: [FACEBOOK_URL],
          contactPoint: [
            {
              "@type": "ContactPoint",
              telephone: `+${WHATSAPP_NUMBER}`,
              contactType: "customer service",
              email: CONTACT_EMAIL,
              areaServed: "BD",
            },
          ],
        },
      },
    ],
    links: [
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@500;600&text=%E0%A7%B3&display=swap" },
      { rel: "preconnect", href: "https://cdnjs.cloudflare.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: siteCss },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // THEME_BOOT sets data-theme (light/dark) before hydration, so the attribute may differ from the server render.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  return (
    <StoreProvider>
      <a className="skip-link" href="#shop">
        Skip to products
      </a>
      <Announcement />
      <SiteHeader />
      <main>
        <Outlet />
      </main>
      <SiteFooter />
      <FloatingChat />
      <QuickDock />
      <Toast />
      <ProductDialog />
      <BagDrawer />
      <GlobalEffects />
    </StoreProvider>
  );
}

function NotFound() {
  return (
    <section className="section">
      <div className="container">
        <div className="empty-state">
          <h3>We couldn't find that page</h3>
          <p>The piece may have moved. Browse the full collection instead.</p>
          <Link className="button" to="/" hash="shop">
            Browse the collection
          </Link>
        </div>
      </div>
    </section>
  );
}

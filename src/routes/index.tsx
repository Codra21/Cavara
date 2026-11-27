import { createFileRoute, redirect } from "@tanstack/react-router";
import { isCategorySlug, isProductSlug } from "@/domain/catalog";
import { DEFAULT_HOME_SETTINGS } from "@/domain/home-settings";
import { homeQueryOptions, useHome } from "@/lib/query";
import { SITE_URL } from "@/lib/config";
import { safeLoad } from "@/lib/safe-load";
import { HeroSlider } from "@/components/home/HeroSlider";
import { CollectionsSection, OrderingSection, StorySection } from "@/components/home/HomeSections";
import { FeaturedSection, NewArrivalsSection } from "@/components/home/HomeRows";

interface HomeSearch {
  category?: string;
  product?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...(isCategorySlug(search.category) ? { category: search.category } : {}),
    ...(isProductSlug(search.product) ? { product: search.product } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.category)
      throw redirect({ to: "/collections/$category", params: { category: search.category }, statusCode: 301 });
    if (search.product) throw redirect({ to: "/products/$slug", params: { slug: search.product }, statusCode: 301 });
  },
  loader: ({ context }) => safeLoad("home page data", () => context.queryClient.query(homeQueryOptions())),
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
    meta: [{ property: "og:url", content: `${SITE_URL}/` }],
  }),
  component: Home,
});

function Home() {
  const home = useHome();
  const sections = home.settings?.sections ?? DEFAULT_HOME_SETTINGS.sections;
  return (
    <>
      {sections
        .filter((section) => section.visible)
        .map((section) => {
          switch (section.key) {
            case "banner":
              return <HeroSlider key="banner" />;
            case "featured":
              return <FeaturedSection key="featured" heading={section.heading || undefined} />;
            case "new_arrivals":
              return <NewArrivalsSection key="new_arrivals" heading={section.heading || undefined} />;
            case "collections":
              return <CollectionsSection key="collections" heading={section.heading || undefined} />;
            case "philosophy":
              return <StorySection key="philosophy" heading={section.heading || undefined} philosophy={home.settings?.philosophy} />;
            case "ordering":
              return <OrderingSection key="ordering" heading={section.heading || undefined} />;
          }
        })}
    </>
  );
}

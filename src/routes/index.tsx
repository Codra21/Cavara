import { createFileRoute, redirect } from "@tanstack/react-router";
import { isCategorySlug, isProductSlug } from "@/domain/catalog";
import { homeQueryOptions } from "@/lib/query";
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
  // Old links: `/?category=x` is now `/collections/x`, and the static site's `/?product=<slug>` is the product page.
  // Neither needs a lookup: an id or slug that does not exist is a 404 on the page it lands on.
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
  return (
    <>
      <HeroSlider />
      <FeaturedSection />
      <NewArrivalsSection />
      <CollectionsSection />
      <StorySection />
      <OrderingSection />
    </>
  );
}

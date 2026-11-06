import { createFileRoute, redirect } from "@tanstack/react-router";
import { indexCatalog, isCategorySlug } from "@/domain/catalog";
import { catalogQueryOptions } from "@/lib/query";
import { SITE_URL } from "@/lib/config";
import { HeroSlider } from "@/components/home/HeroSlider";
import {
  CarouselSection,
  CollectionsSection,
  LookbookSection,
  OrderingSection,
  PromoSection,
  StorySection,
} from "@/components/home/HomeSections";
import { ShopSection } from "@/components/home/ShopSection";

interface HomeSearch {
  category?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    isCategorySlug(search.category) ? { category: search.category } : {},
  // Old static-site links used `/?product=<slug>`; send them to the product route.
  beforeLoad: async ({ context, location }) => {
    const slug = (location.search as Record<string, unknown>).product;
    if (typeof slug !== "string") return;
    const catalog = indexCatalog(await context.queryClient.query(catalogQueryOptions()));
    if (catalog.productBySlug.has(slug)) throw redirect({ to: "/products/$slug", params: { slug }, statusCode: 301 });
  },
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
    meta: [{ property: "og:url", content: `${SITE_URL}/` }],
  }),
  component: Home,
});

function Home() {
  const { category = "all" } = Route.useSearch();
  return (
    <>
      <HeroSlider />
      <CollectionsSection />
      <ShopSection category={category} />
      <LookbookSection />
      <CarouselSection />
      <PromoSection />
      <StorySection />
      <OrderingSection />
    </>
  );
}

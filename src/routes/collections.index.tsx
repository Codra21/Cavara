import { createFileRoute } from "@tanstack/react-router";
import { pluralize } from "@/domain/catalog";
import { SITE_URL } from "@/lib/config";
import { CategoryLink } from "@/components/shop/CategoryLink";
import { useCategories } from "@/lib/query";

export const Route = createFileRoute("/collections/")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/collections` }],
    meta: [
      { title: "Collections — Cavara" },
      {
        name: "description",
        content: "Explore Cavara's curated home decor, tableware, drinkware, and kitchen collections in Bangladesh.",
      },
      { property: "og:url", content: `${SITE_URL}/collections` },
    ],
  }),
  component: CollectionsIndexPage,
});

function CollectionsIndexPage() {
  const { categories } = useCategories();
  return (
    <section className="section collections" aria-labelledby="collections-page-title">
      <div className="container-wide">
        <div className="section-head">
          <p className="sub-heading">Shop by categories</p>
          <h1 id="collections-page-title">Our collections</h1>
        </div>
        <ul className="studio-category-row" aria-label="Collections">
          {categories
            .filter((category) => !category.parentId)
            .map((category) => (
              <li key={category.id}>
                <CategoryLink className="studio-category" category={category.id}>
                  <span className="studio-category-media">
                    <img src={category.image} alt="" loading="lazy" width={800} height={1000} />
                  </span>
                  <span className="studio-category-label">
                    <span className="studio-category-name">{category.name}</span>
                    <span className="studio-category-count">{pluralize(category.count, "piece")}</span>
                  </span>
                </CategoryLink>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ProductCard as Card } from "@/domain/catalog-snapshot";
import { useHome } from "@/lib/query";
import { ProductCard } from "./ProductCard";

function Row({
  id,
  kicker,
  title,
  products,
  categoryNames,
  viewAll,
}: {
  id: string;
  kicker: string;
  title: string;
  products: Card[];
  categoryNames: Record<string, string>;
  viewAll: ReactNode;
}) {
  if (products.length === 0) return null;
  return (
    <section className="section home-row" id={id} aria-labelledby={`${id}-title`}>
      <div className="container-wide">
        <div className="section-head" data-reveal="">
          <p className="sub-heading">{kicker}</p>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <ul className="product-grid" aria-label={title}>
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={categoryNames[product.category] ?? ""}
              index={index}
            />
          ))}
        </ul>
        <div className="home-row-more">{viewAll}</div>
      </div>
    </section>
  );
}

/** Up to eight featured products in display order. */
export function FeaturedSection() {
  const { featured, categoryNames } = useHome();
  return (
    <Row
      id="featured"
      kicker="Our picks"
      title="Featured"
      products={featured}
      categoryNames={categoryNames}
      viewAll={
        <Link className="button button-outline" to="/products">
          View all
        </Link>
      }
    />
  );
}

/** The eight most recently added products. */
export function NewArrivalsSection() {
  const { newest, categoryNames } = useHome();
  return (
    <Row
      id="new-arrivals"
      kicker="Just added"
      title="New arrivals"
      products={newest}
      categoryNames={categoryNames}
      viewAll={
        <Link className="button button-outline" to="/products" search={{ sort: "newest" }}>
          View all
        </Link>
      }
    />
  );
}

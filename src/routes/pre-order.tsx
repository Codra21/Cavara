import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductCard } from "@/components/home/ProductCard";
import { listingQueryOptions } from "@/lib/query";
import { safeLoad } from "@/lib/safe-load";

export const Route = createFileRoute("/pre-order")({
  loader: ({ context }) =>
    safeLoad("pre-order products", () => context.queryClient.ensureQueryData(listingQueryOptions({ availability: "preorder" }))),
  head: () => ({
    meta: [
      { title: "Pre-order — Cavara" },
      { name: "description", content: "Browse pieces available for pre-order at Cavara and request directly on WhatsApp." },
    ],
  }),
  component: PreOrderPage,
});

function PreOrderPage() {
  const { data } = useSuspenseQuery(listingQueryOptions({ availability: "preorder" }));
  return (
    <section className="section shop listing" aria-labelledby="preorder-title">
      <div className="container-wide">
        <nav className="pdp-crumbs listing-crumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/">Home</Link>
            </li>
            <li aria-current="page">Pre-order</li>
          </ol>
        </nav>
        <div className="section-head">
          <p className="sub-heading">Made to order</p>
          <h1 id="preorder-title">Pre-order</h1>
          <p className="section-note">
            Every piece currently open for pre-order across all collections. Open a piece and tap Request on WhatsApp —
            our team calls first to confirm and arrange the 50% advance by phone.
          </p>
        </div>
        {data.products.length > 0 ? (
          <ul className="product-grid">
            {data.products.map((product, index) => (
              <li key={product.id}>
                <ProductCard product={product} categoryName={data.categoryNames[product.category] ?? ""} index={index} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <p>No pieces are on pre-order right now.</p>
            <Link to="/products" className="button">
              Browse all products
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

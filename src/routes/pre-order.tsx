import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductCard } from "@/components/home/ProductCard";
import { listingQueryOptions } from "@/lib/query";
import { safeLoad } from "@/lib/safe-load";

export const Route = createFileRoute("/pre-order")({
  // Every page, not just the first 24: the page lists all pre-order pieces at once. Pages come from the cached
  // summary (no D1), and there are rarely more than one or two.
  loader: ({ context }) =>
    safeLoad("pre-order products", async () => {
      const first = await context.queryClient.query(listingQueryOptions(PREORDER));
      await Promise.all(
        laterPages(first.pageCount).map((page) =>
          context.queryClient.query(listingQueryOptions({ ...PREORDER, page })),
        ),
      );
    }),
  head: () => ({
    meta: [
      { title: "Pre-order — Cavara" },
      {
        name: "description",
        content: "Browse pieces available for pre-order at Cavara and request directly on WhatsApp.",
      },
    ],
  }),
  component: PreOrderPage,
});

const PREORDER = { availability: "preorder" } as const;
const laterPages = (pageCount: number) => Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);

function PreOrderPage() {
  const { data: first } = useSuspenseQuery(listingQueryOptions(PREORDER));
  const rest = useSuspenseQueries({
    queries: laterPages(first.pageCount).map((page) => listingQueryOptions({ ...PREORDER, page })),
  });
  const data = {
    products: [first, ...rest.map((result) => result.data)].flatMap((page) => page.products),
    categoryNames: Object.assign({}, first.categoryNames, ...rest.map((result) => result.data.categoryNames)),
  };
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
            Every piece currently open for pre-order across all collections. Open a piece and tap Request on WhatsApp.
            Our team calls first to confirm and arrange the 50% advance by phone.
          </p>
        </div>
        {data.products.length > 0 ? (
          <ul className="product-grid">
            {data.products.map((product, index) => (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  categoryName={data.categoryNames[product.category] ?? ""}
                  index={index}
                />
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

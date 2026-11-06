import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { adminCategoriesQuery, adminProductQuery } from "@/components/admin/queries";
import { ProductEditor } from "@/components/admin/ProductEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/admin/products/$productId")({
  component: ProductEditorRoute,
});

/** "new" or a positive whole number; anything else is treated as not found. */
function parseProductId(raw: string): number | "new" | null {
  if (raw === "new") return "new";
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

function ProductEditorRoute() {
  const { productId } = Route.useParams();
  const id = parseProductId(productId);
  const numericId = typeof id === "number" ? id : 0;
  const categories = useQuery(adminCategoriesQuery());
  const product = useQuery({ ...adminProductQuery(numericId), enabled: numericId > 0 });

  const back = (
    <Link to="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> All products
    </Link>
  );

  const error = categories.error ?? product.error;
  if (error) {
    return (
      <>
        {back}
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message || "Could not load this product."}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (id === null || (numericId > 0 && product.data === null)) {
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">This product does not exist.</p>
      </>
    );
  }
  if (!categories.data || (numericId > 0 && !product.data)) {
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  const loaded = product.data ?? null;
  return (
    <>
      {back}
      {/* A new revision (after any save) remounts the form with the saved values. */}
      <ProductEditor key={loaded ? `${loaded.id}:${loaded.revision}` : "new"} product={loaded} categories={categories.data} />
    </>
  );
}

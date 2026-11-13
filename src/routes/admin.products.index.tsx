import { createFileRoute } from "@tanstack/react-router";
import { ProductList } from "@/components/admin/ProductList";
import { parseAdminProductSearch } from "@/domain/admin-product-list";

// Filters, sort and cursor live in the URL so a page can be bookmarked and the back button works. Anything invalid in
// the address bar is dropped, not an error.
export const Route = createFileRoute("/admin/products/")({
  validateSearch: parseAdminProductSearch,
  component: ProductList,
});

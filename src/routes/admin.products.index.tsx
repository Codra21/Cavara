import { createFileRoute } from "@tanstack/react-router";
import { ProductList } from "@/components/admin/ProductList";

export const Route = createFileRoute("/admin/products/")({
  component: ProductList,
});

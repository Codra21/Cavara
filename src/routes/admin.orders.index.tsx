import { createFileRoute } from "@tanstack/react-router";
import { OrderList } from "@/components/admin/OrderList";

export const Route = createFileRoute("/admin/orders/")({
  component: OrderList,
});

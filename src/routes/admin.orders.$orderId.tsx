import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { adminOrderQuery } from "@/components/admin/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/admin/orders/$orderId")({
  component: OrderRoute,
});

function OrderRoute() {
  const { orderId } = Route.useParams();
  const { adminSession } = Route.useRouteContext();
  const valid = UUID.test(orderId);
  const order = useQuery({ ...adminOrderQuery(orderId), enabled: valid });

  const back = (
    <Link
      to="/admin/orders"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> All orders
    </Link>
  );

  if (order.isError) {
    return (
      <>
        {back}
        <Alert variant="destructive" role="alert">
          <AlertDescription>{order.error.message || "Could not load this order."}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (!valid || order.data === null) {
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">This order does not exist.</p>
      </>
    );
  }
  if (!order.data) {
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  return (
    <>
      {back}
      {/* A new version (after any save) remounts the form with the saved values. */}
      <OrderDetail
        key={`${order.data.id}:${order.data.version}`}
        order={order.data}
        isOwner={adminSession.admin?.role === "owner"}
      />
    </>
  );
}

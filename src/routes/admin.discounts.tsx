import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CouponEditor } from "@/components/admin/CouponEditor";
import { DiscountEditor } from "@/components/admin/DiscountEditor";
import { adminCouponsQuery, adminDiscountsQuery } from "@/components/admin/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/admin/discounts")({
  component: DiscountsRoute,
});

function DiscountsRoute() {
  const discounts = useQuery(adminDiscountsQuery());
  const coupons = useQuery(adminCouponsQuery());
  if (discounts.isError || coupons.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {(discounts.error ?? coupons.error)?.message || "Could not load the sales and coupons."}
        </AlertDescription>
      </Alert>
    );
  }
  if (!discounts.data || !coupons.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-12">
      <DiscountEditor discounts={discounts.data} />
      <CouponEditor coupons={coupons.data} />
    </div>
  );
}

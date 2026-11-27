import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Boxes,
  ImagePlus,
  LogIn,
  LogOut,
  Package,
  Percent,
  ShieldBan,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  Truck,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AdminAuditEntry } from "@/domain/admin";
import { formatPrice } from "@/domain/catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auditQuery } from "./queries";

const ACTION_LABELS: Record<string, string> = {
  "session.signed_in": "Signed in",
  "session.signed_out": "Signed out",
  "product.created": "Created product",
  "product.updated": "Updated product",
  "product.duplicated": "Copied product",
  "product.bulk_publish": "Published products",
  "product.bulk_unpublish": "Unpublished products",
  "product.bulk_archive": "Archived products",
  "product.bulk_feature": "Featured products",
  "product.bulk_unfeature": "Unfeatured products",
  "product.bulk_set_category": "Changed product category",
  "image.uploaded": "Uploaded picture",
  "stock.started": "Started counting stock",
  "stock.adjusted": "Changed stock",
  "stock.stopped": "Stopped counting stock",
  "order.updated": "Updated order",
  "home.updated": "Updated home page",
  "category.created": "Created category",
  "category.updated": "Updated category",
  "product.bulk_new_arrival": "Marked as new arrival",
  "product.bulk_clear_new_arrival": "Removed from new arrivals",
  "zones.updated": "Updated delivery areas",
  "discount.created": "Added sale",
  "discount.updated": "Updated sale",
  "coupon.created": "Added coupon",
  "coupon.updated": "Updated coupon",
  "phone.blocked": "Blocked number",
  "phone.unblocked": "Unblocked number",
};

// Fixed time zone so every admin sees shop time, whatever their device says.
export const adminTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function actionVisual(action: string): { icon: ReactNode; tone: string } {
  if (action.startsWith("order.")) return { icon: <ShoppingBag />, tone: "bg-info-soft text-info" };
  if (action.startsWith("product.")) return { icon: <Package />, tone: "bg-primary/10 text-primary" };
  if (action.startsWith("stock.")) return { icon: <Boxes />, tone: "bg-warning-soft text-warning" };
  if (action.startsWith("image.")) return { icon: <ImagePlus />, tone: "bg-dispatch-soft text-dispatch" };
  if (action.startsWith("discount.")) return { icon: <Percent />, tone: "bg-success-soft text-success" };
  if (action.startsWith("coupon.")) return { icon: <Ticket />, tone: "bg-success-soft text-success" };
  if (action === "zones.updated") return { icon: <Truck />, tone: "bg-dispatch-soft text-dispatch" };
  if (action === "phone.blocked") return { icon: <ShieldBan />, tone: "bg-danger-soft text-destructive" };
  if (action === "phone.unblocked") return { icon: <ShieldCheck />, tone: "bg-success-soft text-success" };
  if (action === "session.signed_in") return { icon: <LogIn />, tone: "bg-muted text-muted-foreground" };
  if (action === "session.signed_out") return { icon: <LogOut />, tone: "bg-muted text-muted-foreground" };
  return { icon: <Activity />, tone: "bg-muted text-muted-foreground" };
}

function describe(entry: AdminAuditEntry): string | null {
  const { status, price } = entry.details;
  // Products carry a name, orders a reference.
  const name = entry.details.name ?? entry.details.reference ?? entry.details.colour;
  if (typeof name !== "string") return null;
  const parts = [name];
  if (typeof status === "string") parts.push(status);
  if (typeof price === "number") parts.push(formatPrice(price));
  return parts.join(" · ");
}

export function ActivityLog() {
  const audit = useQuery(auditQuery());

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="size-4 text-primary" />
          <CardTitle>Activity</CardTitle>
        </div>
        <CardDescription>The latest 100 admin actions, in Bangladesh time.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {audit.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{audit.error.message || "Could not load the activity log."}</AlertDescription>
          </Alert>
        ) : null}
        {audit.data && audit.data.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : null}
        {audit.data && audit.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {audit.data.map((entry) => {
              const summary = describe(entry);
              const visual = actionVisual(entry.action);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md ${visual.tone} [&_svg]:size-3.5`}
                      aria-hidden="true"
                    >
                      {visual.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                      {summary ? <span className="text-foreground"> {summary}</span> : null}
                      <span className="text-muted-foreground"> · {entry.actorUsername}</span>
                    </span>
                  </div>
                  <time className="text-xs text-muted-foreground tabular-nums" dateTime={entry.createdAt}>
                    {adminTimeFormat.format(new Date(entry.createdAt))}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

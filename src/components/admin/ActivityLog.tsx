import { useQuery } from "@tanstack/react-query";
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
  "image.uploaded": "Uploaded picture",
  "order.updated": "Updated order",
  "zones.updated": "Updated delivery areas",
};

// Fixed time zone so every admin sees shop time, whatever their device says.
export const adminTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function describe(entry: AdminAuditEntry): string | null {
  const { status, price } = entry.details;
  // Products carry a name, orders a reference.
  const name = entry.details.name ?? entry.details.reference;
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
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>The latest 100 admin actions, in Bangladesh time.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {audit.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{audit.error.message || "Could not load the activity log."}</AlertDescription>
          </Alert>
        ) : null}
        {audit.data && audit.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : null}
        {audit.data && audit.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {audit.data.map((entry) => {
              const summary = describe(entry);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    {summary ? <span className="text-foreground"> {summary}</span> : null}
                    <span className="text-muted-foreground"> · {entry.actorUsername}</span>
                  </span>
                  <time className="text-muted-foreground tabular-nums" dateTime={entry.createdAt}>
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

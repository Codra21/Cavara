import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { adminZonesQuery } from "@/components/admin/queries";
import { ZoneEditor } from "@/components/admin/ZoneEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/admin/zones")({
  component: ZonesRoute,
});

function ZonesRoute() {
  const zones = useQuery(adminZonesQuery());
  if (zones.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{zones.error.message || "Could not load delivery areas."}</AlertDescription>
      </Alert>
    );
  }
  if (!zones.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // No remount on refetch: the editor resets its rows from the save response and keeps its "Saved" message.
  return <ZoneEditor zones={zones.data} />;
}

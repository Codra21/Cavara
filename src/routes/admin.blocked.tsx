import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BlockedPhonesList } from "@/components/admin/BlockedPhonesList";
import { adminBlockedPhonesQuery } from "@/components/admin/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/admin/blocked")({
  component: BlockedRoute,
});

function BlockedRoute() {
  const blocked = useQuery(adminBlockedPhonesQuery());
  if (blocked.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{blocked.error.message || "Could not load the blocked numbers."}</AlertDescription>
      </Alert>
    );
  }
  if (!blocked.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <BlockedPhonesList blocked={blocked.data} />;
}

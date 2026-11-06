import { createFileRoute, Link } from "@tanstack/react-router";
import { ActivityLog } from "@/components/admin/ActivityLog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Delivery zones and orders arrive here in the next updates.</p>
        </div>
        <Button asChild>
          <Link to="/admin/products">Manage products</Link>
        </Button>
      </div>
      <ActivityLog />
    </>
  );
}

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AdminSignIn } from "@/components/admin/AdminSignIn";
import { AdminWorkspace } from "@/components/admin/AdminWorkspace";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminSessionFn } from "@/server/functions/admin-auth.functions";

// Direct-link only: nothing on the storefront links here, and search engines are told not to index it.
export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Cavara" }, { name: "robots", content: "noindex, nofollow" }] }),
  // Private and per-visitor, so it bypasses the query cache and is reloaded on every visit.
  loader: () => getAdminSessionFn(),
  staleTime: 0,
  component: AdminRoute,
});

function AdminRoute() {
  const session = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  if (!session.configured) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin is not set up</CardTitle>
            <CardDescription>
              Set the ADMIN_SECRET secret for this Worker (and optionally ADMIN_USERNAME), then reload this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  if (!session.admin) return <AdminSignIn onSignedIn={refresh} />;
  return <AdminWorkspace admin={session.admin} onSignedOut={refresh} />;
}

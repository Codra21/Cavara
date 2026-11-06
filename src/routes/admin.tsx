import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminSignIn } from "@/components/admin/AdminSignIn";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminSessionFn } from "@/server/functions/admin-auth.functions";

// Layout for every /admin page. Direct-link only: nothing on the storefront links here, and search engines are told
// not to index it. The session check runs in beforeLoad, which finishes before any child route loads, and child
// pages render (and fetch) only inside the signed-in shell.
export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Cavara" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => ({ adminSession: await getAdminSessionFn() }),
  component: AdminLayout,
});

function AdminLayout() {
  const { adminSession: session } = Route.useRouteContext();
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
  return (
    <AdminShell admin={session.admin} onSignedOut={refresh}>
      <Outlet />
    </AdminShell>
  );
}

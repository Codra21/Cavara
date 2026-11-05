import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAuditEntry, AdminIdentity } from "@/domain/admin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/ui/primitives";
import { listAuditFn, signOutFn } from "@/server/functions/admin-auth.functions";

/** Private admin queries live under this key so sign-out can drop them all at once. */
export const ADMIN_QUERY_KEY = ["admin"] as const;

const ACTION_LABELS: Record<string, string> = {
  "session.signed_in": "Signed in",
  "session.signed_out": "Signed out",
};

// Fixed time zone so every admin sees shop time, whatever their device says.
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });

function ActivityLog() {
  const audit = useQuery({
    queryKey: [...ADMIN_QUERY_KEY, "audit"],
    queryFn: ({ signal }) => listAuditFn({ signal }),
  });

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
        {audit.data && audit.data.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
        {audit.data && audit.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {audit.data.map((entry: AdminAuditEntry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-foreground">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                  <span className="text-muted-foreground"> · {entry.actorUsername}</span>
                </span>
                <time className="text-muted-foreground tabular-nums" dateTime={entry.createdAt}>
                  {timeFormat.format(new Date(entry.createdAt))}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AdminWorkspace({ admin, onSignedOut }: { admin: AdminIdentity; onSignedOut: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await signOutFn();
    } finally {
      // Order matters: removing a query while its component is still mounted makes it refetch (and fail with 401).
      // Cancel in-flight requests, let the route switch to the sign-in form, then drop the private data.
      await queryClient.cancelQueries({ queryKey: ADMIN_QUERY_KEY });
      await onSignedOut();
      queryClient.removeQueries({ queryKey: ADMIN_QUERY_KEY });
      // Still mounted only if the session survived (the sign-out request failed); re-enable the button.
      setPending(false);
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <span className="text-sm font-medium text-muted-foreground">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Signed in as <span className="font-medium text-foreground">{admin.username}</span>
            </span>
            <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
              {pending ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Products, delivery zones and orders arrive here in the next updates.
          </p>
        </div>
        <ActivityLog />
      </main>
    </div>
  );
}

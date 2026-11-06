import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import type { AdminIdentity } from "@/domain/admin";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/ui/primitives";
import { signOutFn } from "@/server/functions/admin-auth.functions";
import { ADMIN_QUERY_KEY } from "./queries";

const navClass =
  "rounded-sm px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const activeNavClass = "bg-muted text-foreground";

export function AdminShell({
  admin,
  onSignedOut,
  children,
}: {
  admin: AdminIdentity;
  onSignedOut: () => Promise<void>;
  children: ReactNode;
}) {
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/admin" className="flex items-center gap-3" aria-label="Admin home">
              <BrandLogo />
            </Link>
            <nav aria-label="Admin" className="flex items-center gap-1">
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className={navClass}
                activeProps={{ className: activeNavClass }}
              >
                Overview
              </Link>
              <Link to="/admin/products" className={navClass} activeProps={{ className: activeNavClass }}>
                Products
              </Link>
            </nav>
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
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8">{children}</main>
    </div>
  );
}

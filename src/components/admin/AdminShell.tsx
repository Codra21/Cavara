import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Moon, Package, Percent, ShieldBan, ShoppingBag, Sun, Truck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { AdminIdentity } from "@/domain/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/ui/primitives";
import { applyTheme, saveTheme, type Theme } from "@/lib/theme";
import { signOutFn } from "@/server/functions/admin-auth.functions";
import { ADMIN_QUERY_KEY } from "./queries";

const navClass =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md whitespace-nowrap px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4";
const activeNavClass = "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

/** The admin layout has no StoreProvider (see RootLayout), so it keeps its own theme state on the shared helpers. */
function useAdminTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // THEME_BOOT already applied the theme before hydration; read it back.
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next: Theme = dark ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setDark(next === "dark");
  }

  return { dark, toggle };
}

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
  const { dark, toggle } = useAdminTheme();

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
    <div className="min-h-svh bg-admin-canvas text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          {/* `contents` on phones lets the logo, actions and nav sit in one flex container: logo and actions on row 1,
              the nav alone (scrolling sideways) on row 2. From md up this wrapper is a real flex row again. */}
          <div className="contents md:flex md:flex-wrap md:items-center md:gap-x-5 md:gap-y-2">
            <Link to="/admin" className="order-1 flex items-center gap-2.5 md:order-none" aria-label="Admin home">
              <BrandLogo />
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Admin
              </span>
            </Link>
            <nav
              aria-label="Admin"
              className="order-3 flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto md:flex-wrap md:overflow-visible"
            >
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className={navClass}
                activeProps={{ className: activeNavClass }}
              >
                <LayoutDashboard />
                Overview
              </Link>
              <Link to="/admin/orders" className={navClass} activeProps={{ className: activeNavClass }}>
                <ShoppingBag />
                Orders
              </Link>
              <Link to="/admin/products" className={navClass} activeProps={{ className: activeNavClass }}>
                <Package />
                Products
              </Link>
              {admin.role === "owner" ? (
                <>
                  <Link to="/admin/discounts" className={navClass} activeProps={{ className: activeNavClass }}>
                    <Percent />
                    Sales
                  </Link>
                  <Link to="/admin/blocked" className={navClass} activeProps={{ className: activeNavClass }}>
                    <ShieldBan />
                    Blocked
                  </Link>
                  <Link to="/admin/zones" className={navClass} activeProps={{ className: activeNavClass }}>
                    <Truck />
                    Delivery
                  </Link>
                </>
              ) : null}
            </nav>
          </div>
          <div className="order-2 flex items-center gap-2 md:order-none">
            <div className="hidden items-center gap-2 pr-1 text-sm sm:flex">
              <span className="font-medium text-foreground">{admin.username}</span>
              <Badge variant={admin.role === "owner" ? "info" : "secondary"} className="capitalize">
                {admin.role}
              </Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label={dark ? "Switch to Teal light theme" : "Switch to Midnight dark theme"}
              title={dark ? "Switch to Teal light theme" : "Switch to Midnight dark theme"}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
              <LogOut />
              {pending ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

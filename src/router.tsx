import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { RouteErrorPage } from "@/components/layout/ErrorPage";
import { routeTree } from "./routeTree.gen";

// A fresh QueryClient per request on the server (TanStack Router "TanStack Query Integration" docs).
export function getRouter() {
  const queryClient = new QueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Child routes that fail render inside the storefront layout; the root route has its own boundary (__root.tsx).
    defaultErrorComponent: RouteErrorPage,
  });
  setupRouterSsrQueryIntegration({
    router,
    queryClient,
    // The integration sends every query to the browser by default, failed ones included, and a failed query keeps its
    // error message ("D1_ERROR: …") in the page HTML. Skip them: the page that renders on failure is the error page.
    dehydrateOptions: { shouldDehydrateQuery: (query) => query.state.status !== "error" },
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

import { createFileRoute } from "@tanstack/react-router";
import { healthResponse } from "@/server/health";

// Never add a static public/healthz: static assets are served before the Worker and would answer instead.
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: () => healthResponse(),
    },
  },
});

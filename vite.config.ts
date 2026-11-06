import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import viteReact from "@vitejs/plugin-react";

// Plugin order: tailwindcss first (Tailwind Vite docs), then cloudflare (ssr env) → tanstackStart → react
// (TanStack Start + Cloudflare docs).
// `bun run dev:remote` (CAVARA_REMOTE_DB=1): read and write the real cavara-dev instead of the local D1, with the
// catalogue snapshot on, as in production. Never set for builds.
const remoteDb = process.env.CAVARA_REMOTE_DB === "1";

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config: (worker) =>
        remoteDb
          ? {
              d1_databases: worker.d1_databases.map((database) => ({ ...database, remote: true })),
              vars: { ...worker.vars, CATALOG_SNAPSHOT_KEY: "snapshots/catalog-v1.json" },
            }
          : undefined,
    }),
    tanstackStart(),
    viteReact(),
  ],
});

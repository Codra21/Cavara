import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import viteReact from "@vitejs/plugin-react";

// Plugin order: tailwindcss first (Tailwind Vite docs), then cloudflare (ssr env) → tanstackStart → react
// (TanStack Start + Cloudflare docs).
// `bun run dev:remote` (CAVARA_REMOTE_DB=1): read and write the real cavara-dev and cavara-images-dev instead of the
// local D1 and R2, with the catalogue snapshots on (key below, plus the v2 objects beside it), as in production.
// Every remote binding call goes through a proxy Worker and counts as a Worker request on the account, so plain
// `bun run dev` stays fully local. Never set for builds.
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
              r2_buckets: worker.r2_buckets.map((bucket) => ({ ...bucket, remote: true })),
              vars: { ...worker.vars, CATALOG_SNAPSHOT_KEY: "snapshots/catalog-v1.json" },
            }
          : undefined,
    }),
    tanstackStart(),
    viteReact(),
  ],
});

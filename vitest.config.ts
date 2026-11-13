import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Minimal config for component tests. The full vite.config.ts adds the Cloudflare and TanStack Start plugins,
// which are for dev and build only and are not needed to render components in jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/ui-test/setup.ts"],
    css: false,
    include: ["src/**/*.ui.test.tsx"],
  },
});

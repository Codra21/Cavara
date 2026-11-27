// Owner-only home editor server functions.
import { createServerFn } from "@tanstack/react-start";
import { type HomeSettings, homeSettingsSchema } from "@/domain/home-settings";
import { catalogSources } from "@/server/catalog-sources.server";
import { readHomeSettings, saveHomeSettings } from "@/server/db/admin-home.repository";
import { getDb } from "@/server/env";
import { refreshHomeSettings } from "@/server/home-cache.server";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export const getAdminHomeSettingsFn = createServerFn({ method: "GET" })
  .middleware([ownerAuthMiddleware])
  .handler(async () => {
    const sources = catalogSources();
    const settings = await readHomeSettings(getDb());
    return { settings, imageBase: sources.imageBase };
  });

export const saveHomeSettingsFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator(homeSettingsSchema)
  .handler(async ({ context, data }): Promise<{ ok: true; settings: HomeSettings; warning?: string }> => {
    const result = await saveHomeSettings(getDb(), context.admin, data);
    const refreshed = await refreshHomeSettings(catalogSources(), result.settings);
    return refreshed
      ? result
      : {
          ...result,
          warning: "Saved, but the home cache could not refresh immediately. It will catch up within 5 minutes.",
        };
  });

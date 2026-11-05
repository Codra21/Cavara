// Public catalogue server function. Safe to import anywhere: the build replaces the handler with an RPC stub on
// the client (TanStack Start server-functions guide), so the repository and D1 never reach the browser.
import { createServerFn } from "@tanstack/react-start";
import { getPublishedCatalog } from "@/server/db/catalog.repository";
import { getDb } from "@/server/env";

export const getCatalogFn = createServerFn({ method: "GET" }).handler(() => getPublishedCatalog(getDb()));

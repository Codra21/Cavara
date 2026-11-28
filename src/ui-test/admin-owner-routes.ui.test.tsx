import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminSessionState } from "@/domain/admin";

const listManagedCategoriesMock = vi.fn();
const getAdminHomeSettingsMock = vi.fn();

vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] }));
vi.mock("@/components/admin/CategoryManager", () => ({ CategoryManager: () => null }));
vi.mock("@/components/admin/HomeEditor", () => ({ HomeEditor: () => null }));

vi.mock("@/server/functions/admin-categories.functions", () => ({
  listManagedCategoriesFn: listManagedCategoriesMock,
}));

vi.mock("@/server/functions/admin-home.functions", () => ({
  getAdminHomeSettingsFn: getAdminHomeSettingsMock,
}));

const { Route: AdminCategoriesRoute } = await import("@/routes/admin.categories");
const { Route: AdminHomeRoute } = await import("@/routes/admin.home");

const UNAUTHENTICATED_SESSIONS: Array<{ label: string; session: AdminSessionState }> = [
  { label: "unconfigured admin", session: { configured: false, admin: null } },
  { label: "signed-out visitor", session: { configured: true, admin: null } },
  {
    label: "non-owner staff user",
    session: { configured: true, admin: { id: "2", username: "staff", role: "staff" } },
  },
];

const OWNER_SESSION: AdminSessionState = {
  configured: true,
  admin: { id: "1", username: "owner", role: "owner" },
};

async function runRoutePipeline(
  route: { options: { beforeLoad?: unknown; loader?: unknown } },
  adminSession: AdminSessionState,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const context = { adminSession, queryClient };

  if (typeof route.options.beforeLoad === "function") {
    await (route.options.beforeLoad as (args: { context: typeof context }) => unknown)({ context });
  }
  if (typeof route.options.loader === "function") {
    return await (route.options.loader as (args: { context: typeof context }) => unknown)({ context });
  }
  return undefined;
}

beforeEach(() => {
  listManagedCategoriesMock.mockReset();
  getAdminHomeSettingsMock.mockReset();
});

describe("S2B-5: owner-only admin routes gate auth/role in beforeLoad", () => {
  for (const { label, session } of UNAUTHENTICATED_SESSIONS) {
    test(`/admin/categories redirects ${label} to /admin before calling listManagedCategoriesFn`, async () => {
      listManagedCategoriesMock.mockRejectedValue(new Error("Owner access required."));

      let thrown: unknown;
      try {
        await runRoutePipeline(AdminCategoriesRoute, session);
      } catch (err) {
        thrown = err;
      }

      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as { options?: { to?: string } }).options?.to).toBe("/admin");
      expect(listManagedCategoriesMock).not.toHaveBeenCalled();
    });

    test(`/admin/home redirects ${label} to /admin before calling getAdminHomeSettingsFn`, async () => {
      getAdminHomeSettingsMock.mockRejectedValue(new Error("Owner access required."));

      let thrown: unknown;
      try {
        await runRoutePipeline(AdminHomeRoute, session);
      } catch (err) {
        thrown = err;
      }

      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as { options?: { to?: string } }).options?.to).toBe("/admin");
      expect(getAdminHomeSettingsMock).not.toHaveBeenCalled();
    });
  }

  test("/admin/categories allows signed-in owner and loads managed categories", async () => {
    const categories = [{ id: "cat-1", name: "Cups", slug: "cups" }];
    listManagedCategoriesMock.mockResolvedValue(categories);

    const result = await runRoutePipeline(AdminCategoriesRoute, OWNER_SESSION);

    expect(listManagedCategoriesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(categories);
  });

  test("/admin/home allows signed-in owner and loads home settings", async () => {
    const payload = { settings: { banners: [] }, imageBase: "https://images.example" };
    getAdminHomeSettingsMock.mockResolvedValue(payload);

    const result = await runRoutePipeline(AdminHomeRoute, OWNER_SESSION);

    expect(getAdminHomeSettingsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(payload);
  });
});

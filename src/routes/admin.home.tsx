import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HomeEditor } from "@/components/admin/HomeEditor";
import { ADMIN_QUERY_KEY } from "@/components/admin/queries";
import { getAdminHomeSettingsFn } from "@/server/functions/admin-home.functions";

const adminHomeQueryOptions = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "home"],
    queryFn: () => getAdminHomeSettingsFn(),
  });

export const Route = createFileRoute("/admin/home")({
  loader: ({ context }) => context.queryClient.query(adminHomeQueryOptions()),
  head: () => ({ meta: [{ title: "Home page · Cavara Admin" }] }),
  component: AdminHomePage,
});

function AdminHomePage() {
  const { data } = useSuspenseQuery(adminHomeQueryOptions());
  return <HomeEditor initial={data.settings} imageBase={data.imageBase} />;
}

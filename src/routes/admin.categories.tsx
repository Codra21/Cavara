import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { ADMIN_QUERY_KEY } from "@/components/admin/queries";
import { listManagedCategoriesFn } from "@/server/functions/admin-categories.functions";

const categoriesQueryOptions = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "categories"],
    queryFn: () => listManagedCategoriesFn(),
  });

export const Route = createFileRoute("/admin/categories")({
  beforeLoad: ({ context }) => {
    if (context.adminSession.admin?.role !== "owner") {
      throw redirect({ to: "/admin" });
    }
  },
  loader: ({ context }) => context.queryClient.query(categoriesQueryOptions()),
  head: () => ({ meta: [{ title: "Categories · Cavara Admin" }] }),
  component: AdminCategoriesPage,
});

function AdminCategoriesPage() {
  const { data } = useSuspenseQuery(categoriesQueryOptions());
  return <CategoryManager categories={data} />;
}

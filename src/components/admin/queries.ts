// Private admin queries. All keys start with ADMIN_QUERY_KEY so sign-out can cancel and drop them together.
// Components use useQuery (cancellable via `signal`), never route loaders, so nothing is fetched before the
// /admin layout has confirmed the session.
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AdminOrderPage, OrderStatus } from "@/domain/orders";
import { getOrderFn, listOrdersFn, listZonesFn } from "@/server/functions/admin-orders.functions";
import { listAuditFn } from "@/server/functions/admin-auth.functions";
import {
  getAdminProductFn,
  listAdminCategoriesFn,
  listAdminProductsFn,
} from "@/server/functions/admin-catalog.functions";

export const ADMIN_QUERY_KEY = ["admin"] as const;

export type OrderStatusFilter = OrderStatus | "all";

export const auditQuery = () =>
  queryOptions({ queryKey: [...ADMIN_QUERY_KEY, "audit"], queryFn: ({ signal }) => listAuditFn({ signal }) });

export const adminProductsQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "products"],
    queryFn: ({ signal }) => listAdminProductsFn({ signal }),
  });

export const adminCategoriesQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "categories"],
    queryFn: ({ signal }) => listAdminCategoriesFn({ signal }),
    staleTime: 5 * 60 * 1000,
  });

export const adminProductQuery = (id: number) =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "product", id],
    queryFn: ({ signal }) => getAdminProductFn({ data: { id }, signal }),
  });

export const adminOrdersQuery = (status: OrderStatusFilter, search: string) =>
  infiniteQueryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "orders", status, search],
    queryFn: ({ signal, pageParam }) => listOrdersFn({ data: { status, search, after: pageParam }, signal }),
    initialPageParam: null as AdminOrderPage["next"],
    getNextPageParam: (page) => page.next,
  });

export const adminOrderQuery = (id: string) =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "order", id],
    queryFn: ({ signal }) => getOrderFn({ data: { id }, signal }),
  });

export const adminZonesQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "zones"],
    queryFn: ({ signal }) => listZonesFn({ signal }),
  });

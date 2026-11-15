// Private admin queries. All keys start with ADMIN_QUERY_KEY so sign-out can cancel and drop them together.
// Components use useQuery (cancellable via `signal`), never route loaders, so nothing is fetched before the
// /admin layout has confirmed the session.
import { infiniteQueryOptions, keepPreviousData, type QueryClient, queryOptions } from "@tanstack/react-query";
import type { AdminProductQuery } from "@/domain/admin-product-list";
import type { AdminOrderPage, OrderStatus } from "@/domain/orders";
import type { AdminProductName } from "@/domain/product-admin";
import { getDashboardFn } from "@/server/functions/admin-dashboard.functions";
import { listStockMovementsFn } from "@/server/functions/admin-stock.functions";
import type { StockMovementPage } from "@/domain/stock";
import { listCouponsFn, listDiscountsFn } from "@/server/functions/admin-discounts.functions";
import { getOrderFn, listOrdersFn, listZonesFn } from "@/server/functions/admin-orders.functions";
import { listAuditFn } from "@/server/functions/admin-auth.functions";
import {
  countAdminProductsFn,
  getAdminProductFn,
  listAdminCategoriesFn,
  listAdminProductsFn,
  listProductNamesFn,
} from "@/server/functions/admin-catalog.functions";

export const ADMIN_QUERY_KEY = ["admin"] as const;

export type OrderStatusFilter = OrderStatus | "all";

export const auditQuery = () =>
  queryOptions({ queryKey: [...ADMIN_QUERY_KEY, "audit"], queryFn: ({ signal }) => listAuditFn({ signal }) });

/** One page of the product list. The key holds the whole query (filters, sort, cursor), so each page caches on its own. */
export const adminProductsQuery = (query: AdminProductQuery) =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "products", query],
    queryFn: ({ signal }) => listAdminProductsFn({ data: query, signal }),
    // Keep showing the last page while the next loads, so paging does not flash an empty table.
    placeholderData: keepPreviousData,
    // Saves and bulk actions invalidate it; otherwise a minute-old page is fine and saves D1 reads.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

/** Counts per status for one category (or all). One grouped query over every product's index entry, so cached. */
export const adminProductCountsQuery = (category: string | undefined) =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "product-counts", category ?? null],
    queryFn: ({ signal }) => countAdminProductsFn({ data: { category }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

const NAMES_KEY = [...ADMIN_QUERY_KEY, "product-names"] as const;

/**
 * Id, name, slug and status of every product, filtered in the browser by the search box. It costs one read per product,
 * so it is fetched once per session. Saves patch it in place (patchProductNames) instead of refetching.
 */
export const adminProductNamesQuery = () =>
  queryOptions({
    queryKey: NAMES_KEY,
    queryFn: ({ signal }) => listProductNamesFn({ signal }),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
  });

/** Adds or updates entries of the cached name list. Does nothing until the list has been fetched. */
export function patchProductNames(client: QueryClient, changed: AdminProductName[]) {
  client.setQueryData<AdminProductName[]>(NAMES_KEY, (current) => {
    if (!current) return current;
    const byId = new Map(changed.map((entry) => [entry.id, entry]));
    const known = new Set(current.map((entry) => entry.id));
    return [...current.map((entry) => byId.get(entry.id) ?? entry), ...changed.filter((entry) => !known.has(entry.id))];
  });
}

const PRODUCT_DATA = new Set(["products", "product-counts", "product", "audit"]);

/**
 * After a product save, bulk action or copy: refresh what depends on products. Not the whole ["admin"] tree, which
 * would refetch the name list (one read per product) after every save; that list is patched instead.
 */
export function invalidateProductData(client: QueryClient) {
  return client.invalidateQueries({
    queryKey: ADMIN_QUERY_KEY,
    predicate: (query) => PRODUCT_DATA.has(String(query.queryKey[1])),
  });
}

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

/** A product's movements, newest first, 50 per page. Dropped and refetched after every stock change. */
export const adminStockMovementsQuery = (productId: number) =>
  infiniteQueryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "stock-movements", productId],
    queryFn: ({ signal, pageParam }) => listStockMovementsFn({ data: { productId, after: pageParam }, signal }),
    initialPageParam: null as StockMovementPage["next"],
    getNextPageParam: (page) => page.next,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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

export const adminDiscountsQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "discounts"],
    queryFn: ({ signal }) => listDiscountsFn({ signal }),
  });

export const adminCouponsQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "coupons"],
    queryFn: ({ signal }) => listCouponsFn({ signal }),
  });

export const adminDashboardQuery = () =>
  queryOptions({
    queryKey: [...ADMIN_QUERY_KEY, "dashboard"],
    queryFn: ({ signal }) => getDashboardFn({ signal }),
    // Totals change only with orders and status changes; a minute is fresh enough and saves D1 reads.
    staleTime: 60_000,
  });

import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ADMIN_PRODUCT_SORTS,
  ADMIN_SORT_LABELS,
  type AdminProductSearch,
  firstPage,
  withDefaultSort,
} from "@/domain/admin-product-list";
import { formatPrice } from "@/domain/catalog";
import { type AdminProductSummary, type ProductStatus, unitMargin } from "@/domain/product-admin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkBar, DuplicateDialog, type Notice } from "./ProductActions";
import { adminCategoriesQuery, adminProductCountsQuery, adminProductNamesQuery, adminProductsQuery } from "./queries";

const routeApi = getRouteApi("/admin/products/");

export const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const variant = status === "published" ? "default" : status === "draft" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

function Margin({ product }: { product: AdminProductSummary }) {
  const margin = unitMargin(product.price, product.costPrice);
  if (margin === null) return <span className="text-muted-foreground">No cost</span>;
  return <span className={margin < 0 ? "text-destructive" : undefined}>{formatPrice(margin)}</span>;
}

/** Radix Select cannot hold an empty value, so "no filter" is this word. */
const ANY = "all";

/** Name search over the list the browser fetched once (no database query per keystroke). */
function NameSearch({ term }: { term: string }) {
  const names = useQuery({ ...adminProductNamesQuery(), enabled: term.trim() !== "" });
  const needle = term.trim().toLowerCase();
  const matches = useMemo(
    () =>
      (names.data ?? [])
        .filter((entry) => entry.name.toLowerCase().includes(needle) || entry.slug.includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [names.data, needle],
  );

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        {names.isPending ? <p className="p-4 text-sm text-muted-foreground">Loading product names…</p> : null}
        {names.isError ? (
          <Alert variant="destructive" role="alert" className="m-4 w-auto">
            <AlertDescription>{names.error.message || "Could not load product names."}</AlertDescription>
          </Alert>
        ) : null}
        {names.data && matches.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No product matches "{term.trim()}".</p>
        ) : null}
        {matches.length > 0 ? (
          <ul className="divide-y divide-border" aria-label="Search results">
            {matches.slice(0, 50).map((entry) => (
              <li key={entry.id}>
                <Link
                  to="/admin/products/$productId"
                  params={{ productId: String(entry.id) }}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{entry.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{entry.slug}</span>
                  </span>
                  <StatusBadge status={entry.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {matches.length > 50 ? (
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            Showing the first 50 of {matches.length} matches. Type more to narrow them.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProductList() {
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const query = withDefaultSort(search);
  const products = useQuery(adminProductsQuery(query));
  const counts = useQuery(adminProductCountsQuery(query.category));
  const categories = useQuery(adminCategoriesQuery());

  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copying, setCopying] = useState<{ id: number; name: string } | null>(null);

  // A selection belongs to the page it was made on.
  const queryJson = JSON.stringify(query);
  useEffect(() => setSelected(new Set()), [queryJson]);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );
  const rows = products.data?.products ?? [];
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const filtered = Boolean(query.status || query.category || query.outOfStock || query.lowStock);
  const searching = term.trim() !== "";

  const goTo = (next: AdminProductSearch) => navigate({ to: "/admin/products", search: next });
  const changeFilter = (patch: Partial<AdminProductSearch>) => goTo(firstPage({ ...search, ...patch }));

  function toggleRow(id: number, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someOnPage = rows.some((row) => selected.has(row.id));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Published products appear on the shop straight away. Drafts and archived products stay hidden.
          </p>
        </div>
        <Button render={<Link to="/admin/products/$productId" params={{ productId: "new" }} />}>New product</Button>
      </div>

      <Input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search every product by name"
        aria-label="Search products by name"
        className="w-full sm:w-80"
      />

      {searching ? (
        <NameSearch term={term} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {(["all", "published", "draft", "archived"] as const).map((value) => {
                const active = (query.status ?? "all") === value;
                return (
                  <Button
                    key={value}
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    aria-pressed={active}
                    onClick={() => changeFilter({ status: value === "all" ? undefined : value })}
                  >
                    {value === "all" ? "All" : STATUS_LABELS[value]}{" "}
                    <span className="text-muted-foreground tabular-nums">{counts.data?.[value] ?? ""}</span>
                  </Button>
                );
              })}
            </div>
            <Select
              value={query.category ?? ANY}
              onValueChange={(value) => changeFilter({ category: value === ANY ? undefined : value })}
            >
              <SelectTrigger size="sm" aria-label="Filter by category" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All categories</SelectItem>
                {(categories.data ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={query.outOfStock ? "secondary" : "outline"}
              aria-pressed={Boolean(query.outOfStock)}
              onClick={() => changeFilter({ outOfStock: query.outOfStock ? undefined : true })}
            >
              Has an out-of-stock colour
            </Button>
            <Button
              size="sm"
              variant={query.lowStock ? "secondary" : "outline"}
              aria-pressed={Boolean(query.lowStock)}
              onClick={() => changeFilter({ lowStock: query.lowStock ? undefined : true })}
            >
              Low stock
            </Button>
            <Select
              value={query.sort}
              onValueChange={(value) => changeFilter({ sort: value as AdminProductSearch["sort"] })}
            >
              <SelectTrigger size="sm" aria-label="Sort products" className="ml-auto w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_PRODUCT_SORTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ADMIN_SORT_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRows.length > 0 ? (
            <BulkBar
              selected={selectedRows}
              categories={categories.data ?? []}
              onClear={() => setSelected(new Set())}
              onNotice={setNotice}
            />
          ) : null}

          {notice ? (
            <Alert
              variant={notice.kind === "error" ? "destructive" : "default"}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{notice.text}</span>
                <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {products.isError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{products.error.message || "Could not load products."}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="py-0">
            <CardContent className="px-0">
              {products.isPending ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
              {products.data && rows.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  <p>{filtered ? "No products match these filters." : "No products yet."}</p>
                  {filtered ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => goTo({ sort: query.sort === "updated" ? undefined : query.sort })}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {rows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4">
                        <Checkbox
                          checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                          onCheckedChange={(checked) =>
                            setSelected(checked === true ? new Set(rows.map((row) => row.id)) : new Set())
                          }
                          aria-label="Select every product on this page"
                        />
                      </TableHead>
                      <TableHead className="w-14">
                        <span className="sr-only">Picture</span>
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden sm:table-cell">Status</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Cost</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Margin</TableHead>
                      <TableHead className="w-12 pr-4">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((product) => (
                      <TableRow key={product.id} data-state={selected.has(product.id) ? "selected" : undefined}>
                        <TableCell className="pl-4">
                          <Checkbox
                            checked={selected.has(product.id)}
                            onCheckedChange={(checked) => toggleRow(product.id, checked === true)}
                            aria-label={`Select ${product.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          {product.thumbnail ? (
                            <img
                              src={product.thumbnail}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                              decoding="async"
                              className="size-10 rounded-sm bg-muted object-cover"
                            />
                          ) : (
                            <span className="block size-10 rounded-sm bg-muted" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[16rem] whitespace-normal">
                          <Link
                            to="/admin/products/$productId"
                            params={{ productId: String(product.id) }}
                            className="font-medium text-foreground hover:underline"
                          >
                            {product.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {categoryName.get(product.categoryId) ?? product.categoryId} · {product.variantCount}{" "}
                            {product.variantCount === 1 ? "colour" : "colours"}
                            {product.featured ? " · Featured" : ""}
                            {product.outOfStockColours > 0 ? ` · ${product.outOfStockColours} out of stock` : ""}
                            {product.lowStockColours > 0 ? ` · ${product.lowStockColours} low` : ""}
                          </div>
                          {/* Phones: the status column is hidden, so the badge sits under the name. */}
                          <div className="mt-1 sm:hidden">
                            <StatusBadge status={product.status} />
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <StatusBadge status={product.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatPrice(product.price)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {product.costPrice === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatPrice(product.costPrice)
                          )}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          <Margin product={product} />
                        </TableCell>
                        <TableCell className="pr-4">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Duplicate ${product.name}`}
                            onClick={() => setCopying({ id: product.id, name: product.name })}
                          >
                            <Copy />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>

          {products.data && (products.data.prev || products.data.next || query.after || query.before) ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!query.after && !query.before}
                onClick={() => goTo(firstPage(search))}
              >
                First page
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{rows.length} shown</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!products.data.prev}
                  onClick={() => goTo({ ...search, before: products.data?.prev ?? undefined, after: undefined })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!products.data.next}
                  onClick={() => goTo({ ...search, after: products.data?.next ?? undefined, before: undefined })}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}

      <DuplicateDialog product={copying} onClose={() => setCopying(null)} />
    </>
  );
}

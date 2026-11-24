import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileEdit,
  ImageOff,
  Package,
  Plus,
  Search,
  Star,
} from "lucide-react";
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
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkBar, DuplicateDialog, type Notice } from "./ProductActions";
import { adminCategoriesQuery, adminProductCountsQuery, adminProductNamesQuery, adminProductsQuery } from "./queries";

const routeApi = getRouteApi("/admin/products/");

export const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const PRODUCT_BADGE_META: Record<
  ProductStatus,
  { variant: "success" | "warning" | "outline"; icon: typeof CheckCircle2 }
> = {
  published: { variant: "success", icon: CheckCircle2 },
  draft: { variant: "warning", icon: FileEdit },
  archived: { variant: "outline", icon: Archive },
};

function StatusBadge({ status }: { status: ProductStatus }) {
  const { variant, icon: Icon } = PRODUCT_BADGE_META[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function Margin({ product }: { product: AdminProductSummary }) {
  const margin = unitMargin(product.price, product.costPrice);
  if (margin === null) return <span className="text-muted-foreground">No cost</span>;
  return (
    <span className={margin < 0 ? "font-medium text-destructive" : "font-medium text-success"}>
      {formatPrice(margin)}
    </span>
  );
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
            <AlertCircle />
            <AlertDescription>{names.error.message || "Could not load product names."}</AlertDescription>
          </Alert>
        ) : null}
        {names.data && matches.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No product matches "{term.trim()}".</p>
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
        <Button render={<Link to="/admin/products/$productId" params={{ productId: "new" }} />}>
          <Plus /> New product
        </Button>
      </div>

      <div className="relative w-full sm:w-80">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search every product by name"
          aria-label="Search products by name"
          className="bg-card pl-8.5"
        />
      </div>

      {searching ? (
        <NameSearch term={term} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label="Filter by status"
              value={query.status ?? "all"}
              onValueChange={(next) => next && changeFilter({ status: next === "all" ? undefined : next })}
            >
              {(["all", "published", "draft", "archived"] as const).map((value) => (
                <SegmentedControlItem key={value} value={value}>
                  {value === "all" ? "All" : STATUS_LABELS[value]}{" "}
                  <span className="tabular-nums text-muted-foreground in-data-checked:text-inherit in-data-checked:opacity-80">
                    {counts.data?.[value] ?? ""}
                  </span>
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <Select
              value={query.category ?? ANY}
              onValueChange={(value) => changeFilter({ category: value === ANY ? undefined : value })}
            >
              <SelectTrigger size="sm" aria-label="Filter by category" className="w-44 bg-card">
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
            <Toggle
              tone="destructive"
              pressed={Boolean(query.outOfStock)}
              onPressedChange={(pressed) => changeFilter({ outOfStock: pressed ? true : undefined })}
            >
              <AlertCircle /> Out of stock
            </Toggle>
            <Toggle
              tone="warning"
              pressed={Boolean(query.lowStock)}
              onPressedChange={(pressed) => changeFilter({ lowStock: pressed ? true : undefined })}
            >
              <AlertTriangle /> Low stock
            </Toggle>
            <Select
              value={query.sort}
              onValueChange={(value) => changeFilter({ sort: value as AdminProductSearch["sort"] })}
            >
              <SelectTrigger size="sm" aria-label="Sort products" className="ml-auto w-44 bg-card">
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
              variant={notice.kind === "error" ? "destructive" : notice.kind === "warning" ? "warning" : "success"}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.kind === "error" ? (
                <AlertCircle />
              ) : notice.kind === "warning" ? (
                <AlertTriangle />
              ) : (
                <CheckCircle2 />
              )}
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
              <AlertCircle />
              <AlertDescription>{products.error.message || "Could not load products."}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="py-0">
            <CardContent className="px-0">
              {products.isPending ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Loading products…</p>
              ) : null}
              {products.data && rows.length === 0 ? (
                <div className="grid justify-items-center gap-2 p-8 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Package className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    {filtered ? "No products match these filters" : "No products yet"}
                  </p>
                  {filtered ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
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
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
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
                              className="size-10 rounded-md border border-border bg-muted object-cover"
                            />
                          ) : (
                            <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                              <ImageOff className="size-4" aria-hidden="true" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[18rem] whitespace-normal">
                          <div className="flex items-center gap-1.5">
                            <Link
                              to="/admin/products/$productId"
                              params={{ productId: String(product.id) }}
                              className="font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {product.name}
                            </Link>
                            {product.featured ? (
                              <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="Featured" />
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>
                              {categoryName.get(product.categoryId) ?? product.categoryId} · {product.variantCount}{" "}
                              {product.variantCount === 1 ? "colour" : "colours"}
                            </span>
                            {product.outOfStockColours > 0 ? (
                              <Badge variant="destructive" className="h-4.5 px-1.5 text-[11px]">
                                {product.outOfStockColours} out
                              </Badge>
                            ) : null}
                            {product.lowStockColours > 0 ? (
                              <Badge variant="warning" className="h-4.5 px-1.5 text-[11px]">
                                {product.lowStockColours} low
                              </Badge>
                            ) : null}
                          </div>
                          {/* Phones: the status column is hidden, so the badge sits under the name. */}
                          <div className="mt-1 sm:hidden">
                            <StatusBadge status={product.status} />
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <StatusBadge status={product.status} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatPrice(product.price)}
                        </TableCell>
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
                            title={`Duplicate ${product.name}`}
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
                  <ChevronLeft /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!products.data.next}
                  onClick={() => goTo({ ...search, after: products.data?.next ?? undefined, before: undefined })}
                >
                  Next <ChevronRight />
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

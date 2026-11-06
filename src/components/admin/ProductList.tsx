import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { formatPrice } from "@/domain/catalog";
import { type AdminProductSummary, type ProductStatus, unitMargin } from "@/domain/product-admin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCategoriesQuery, adminProductsQuery } from "./queries";

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

export function ProductList() {
  const products = useQuery(adminProductsQuery());
  const categories = useQuery(adminCategoriesQuery());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus | "all">("all");

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (products.data ?? []).filter(
      (product) =>
        (status === "all" || product.status === status) &&
        (!needle || product.name.toLowerCase().includes(needle) || product.slug.includes(needle)),
    );
  }, [products.data, search, status]);

  const counts = useMemo(() => {
    const all = products.data ?? [];
    return {
      all: all.length,
      published: all.filter((p) => p.status === "published").length,
      draft: all.filter((p) => p.status === "draft").length,
      archived: all.filter((p) => p.status === "archived").length,
    };
  }, [products.data]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Published products appear on the shop straight away. Drafts and archived products stay hidden.
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/products/$productId" params={{ productId: "new" }}>
            New product
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          aria-label="Search products"
          className="w-full sm:w-64"
        />
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {(["all", "published", "draft", "archived"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={status === value ? "secondary" : "ghost"}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {value === "all" ? "All" : STATUS_LABELS[value]}{" "}
              <span className="text-muted-foreground tabular-nums">{counts[value]}</span>
            </Button>
          ))}
        </div>
      </div>

      {products.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{products.error.message || "Could not load products."}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          {products.isPending ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
          {products.data && visible.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No products match.</p>
          ) : null}
          {visible.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 pl-4">
                    <span className="sr-only">Picture</span>
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Cost</TableHead>
                  <TableHead className="hidden pr-4 text-right md:table-cell">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="pl-4">
                      {product.thumbnail ? (
                        <img
                          src={product.thumbnail}
                          alt=""
                          width={40}
                          height={40}
                          loading="lazy"
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
                      </div>
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="hidden pr-4 text-right tabular-nums md:table-cell">
                      <Margin product={product} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type BulkProductAction, copyName, describeBulkResult } from "@/domain/admin-product-actions";
import type { AdminCategory, AdminProductName, AdminProductSummary, ProductStatus } from "@/domain/product-admin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkProductActionFn, duplicateProductFn } from "@/server/functions/admin-catalog.functions";
import { ActionDialog } from "./ActionDialog";
import { invalidateProductData, patchProductNames } from "./queries";

export interface Notice {
  kind: "ok" | "warning" | "error";
  text: string;
}

/** Opens a copy of a product in the editor. Only the saved version is copied, not unsaved edits. */
export function DuplicateDialog({
  product,
  onClose,
}: {
  product: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [includeImages, setIncludeImages] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const duplicate = useMutation({
    mutationFn: (source: { id: number; name: string }) =>
      duplicateProductFn({ data: { id: source.id, includeImages } }).then((result) => ({ result, source })),
    onSuccess: async ({ result, source }) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      patchProductNames(queryClient, [
        { id: result.id, name: copyName(source.name), slug: result.slug, status: "draft" },
      ]);
      await invalidateProductData(queryClient);
      onClose();
      await navigate({ to: "/admin/products/$productId", params: { productId: String(result.id) } });
    },
    onError: (failure) => setError(failure.message || "Could not copy this product. Try again."),
  });

  return (
    <ActionDialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
      title="Duplicate product"
      description={
        product
          ? `Makes a draft copy of "${product.name}" with the same text, prices and colours, then opens it. The copy stays hidden from the shop until you publish it.`
          : ""
      }
      confirmLabel="Duplicate"
      pendingLabel="Copying…"
      pending={duplicate.isPending}
      onConfirm={() => product && duplicate.mutate(product)}
    >
      <div className="grid gap-2">
        <div className="flex items-start gap-2">
          <Checkbox
            id="duplicate-images"
            checked={includeImages}
            onCheckedChange={(checked) => setIncludeImages(checked === true)}
          />
          <Label htmlFor="duplicate-images" className="leading-snug">
            Copy pictures
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Both products then use the same picture files. Removing a picture from one never affects the other.
        </p>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ActionDialog>
  );
}

const NEW_STATUS: Partial<Record<BulkProductAction["action"], ProductStatus>> = {
  publish: "published",
  unpublish: "draft",
  archive: "archived",
};

/** What the Owner can do with the selected rows. One server call per click; the server checks each product again. */
export function BulkBar({
  selected,
  categories,
  onClear,
  onNotice,
}: {
  selected: AdminProductSummary[];
  categories: AdminCategory[];
  onClear: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const run = useMutation({
    mutationFn: (action: BulkProductAction) => bulkProductActionFn({ data: action }),
    onSuccess: async (result, action) => {
      setConfirmArchive(false);
      if (!result.ok) {
        onNotice({ kind: "error", text: result.error });
        return;
      }
      const text = describeBulkResult(action.action, result.applied.length, result.skipped);
      onNotice(result.warning ? { kind: "warning", text: `${text} ${result.warning}` } : { kind: "ok", text });
      const status = NEW_STATUS[action.action];
      if (status) {
        const done = new Set(result.applied);
        const changed: AdminProductName[] = selected
          .filter((row) => done.has(row.id))
          .map((row) => ({ id: row.id, name: row.name, slug: row.slug, status }));
        patchProductNames(queryClient, changed);
      }
      onClear();
      await invalidateProductData(queryClient);
    },
    onError: (error) => onNotice({ kind: "error", text: error.message || "Could not apply that. Try again." }),
  });

  const ids = selected.map((row) => row.id);
  const send = (action: BulkProductAction["action"]) => {
    if (action === "set_category") run.mutate({ action, ids, categoryId: category });
    else run.mutate({ action, ids });
  };

  return (
    <div
      role="region"
      aria-label="Actions for the selected products"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2"
    >
      <span className="px-1 text-sm font-medium" aria-live="polite">
        {selected.length} selected
      </span>
      <Button size="sm" onClick={() => send("publish")} disabled={run.isPending}>
        Publish
      </Button>
      <Button size="sm" variant="outline" onClick={() => send("unpublish")} disabled={run.isPending}>
        Unpublish
      </Button>
      <Button size="sm" variant="outline" onClick={() => setConfirmArchive(true)} disabled={run.isPending}>
        Archive
      </Button>
      <Button size="sm" variant="outline" onClick={() => send("feature")} disabled={run.isPending}>
        Feature
      </Button>
      <Button size="sm" variant="outline" onClick={() => send("unfeature")} disabled={run.isPending}>
        Unfeature
      </Button>
      <div className="flex items-center gap-1">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" aria-label="Category to move the selected products to" className="w-40">
            <SelectValue placeholder="Move to category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => send("set_category")} disabled={run.isPending || !category}>
          Move
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={run.isPending} className="ml-auto">
        Clear selection
      </Button>

      <ActionDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${selected.length} ${selected.length === 1 ? "product" : "products"}?`}
        description="Archived products leave the shop and stay in this list under Archived. You can publish them again later."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        pending={run.isPending}
        destructive
        onConfirm={() => send("archive")}
      />
    </div>
  );
}

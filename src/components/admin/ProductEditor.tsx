import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ExternalLink, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/domain/catalog";
import { IMAGE_OPTIMIZATION, MAX_SOURCE_BYTES, mediaUrl, UPLOAD_ACCEPT } from "@/domain/media";
import { optimizeImage } from "@/lib/optimize-image";
import {
  type AdminCategory,
  type AdminProduct,
  AVAILABILITIES,
  emptyProductForm,
  MAX_DETAILS,
  MAX_IMAGES_PER_VARIANT,
  MAX_VARIANTS,
  PRODUCT_STATUSES,
  type ProductFormValues,
  productInputSchema,
  productToForm,
  slugify,
  unitMargin,
} from "@/domain/product-admin";
import { useCatalog } from "@/lib/query";
import type { Availability } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveProductFn } from "@/server/functions/admin-catalog.functions";
import { uploadImageFn } from "@/server/functions/admin-media.functions";
import { STATUS_LABELS } from "./ProductList";
import { ADMIN_QUERY_KEY } from "./queries";

type FormVariant = ProductFormValues["variants"][number];

const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  preorder: "Pre-order",
};

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Whole taka from a number field; blank → null. */
function toTaka(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Optimizes and uploads pictures one at a time and hands back the new R2 keys; the product saves them with everything else. */
function PictureUpload({
  productId,
  label,
  room,
  onUploaded,
}: {
  productId: string;
  label: string;
  room: number;
  onUploaded: (keys: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [summary, setSummary] = useState<string[]>([]);

  async function upload(files: File[]) {
    const problems: string[] = [];
    const accepted = files.slice(0, room);
    if (files.length > room) problems.push(`Only ${room} more picture${room === 1 ? "" : "s"} fit on this colour.`);
    const keys: string[] = [];
    const notes: string[] = [];
    for (const [index, file] of accepted.entries()) {
      if (file.size > MAX_SOURCE_BYTES) {
        problems.push(`${file.name} is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      const step = accepted.length > 1 ? ` ${index + 1} of ${accepted.length}` : "";
      try {
        // Every picture is resized and converted to WebP here; the server accepts nothing else.
        setStatus(`Optimizing${step}…`);
        const optimized = await optimizeImage(file);
        setStatus(`Uploading${step}…`);
        const form = new FormData();
        form.set("file", optimized.file);
        form.set("productId", productId);
        const result = await uploadImageFn({ data: form });
        if (result.ok) {
          keys.push(result.key);
          notes.push(
            `${file.name}: ${formatBytes(optimized.originalBytes)} → ${formatBytes(result.bytes)}, ${result.width}×${result.height}`,
          );
        } else problems.push(result.error);
      } catch (error) {
        problems.push(error instanceof Error && error.message ? error.message : `Could not upload ${file.name}.`);
      }
    }
    if (keys.length) onUploaded(keys);
    setSummary(notes);
    setErrors(problems);
    setStatus(null);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => upload([...(event.target.files ?? [])])}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(status) || room <= 0}
          onClick={() => input.current?.click()}
          aria-label={`Add pictures to ${label}`}
        >
          <ImagePlus /> {status ?? "Add pictures"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Any JPEG, PNG, WebP or AVIF. Pictures are resized to {IMAGE_OPTIMIZATION.maxEdge} px and converted to WebP
          before upload.
        </span>
      </div>
      {summary.length ? (
        <ul aria-live="polite" className="text-xs text-muted-foreground">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {errors.length ? (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VariantCard({
  variant,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onAddImages,
  productId,
  imageBase,
}: {
  variant: FormVariant;
  index: number;
  total: number;
  onChange: (variant: FormVariant) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onAddImages: (keys: string[]) => void;
  productId: string;
  imageBase: string;
}) {
  const id = useId();
  const images = variant.images ?? [];
  const label = variant.name || `Colour ${index + 1}`;
  // Preview only values that pass the server's swatch rule shape (no url()).
  const previewable = !/url\s*\(/i.test(variant.swatch);

  return (
    <li className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="size-6 shrink-0 rounded-full border border-border"
            style={previewable ? { background: variant.swatch } : undefined}
            aria-hidden="true"
          />
          <span className="font-medium">{label}</span>
          {index === 0 ? <span className="text-xs text-muted-foreground">(shown first)</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(index - 1)}
            disabled={index === 0}
            aria-label={`Move ${label} up`}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(index + 1)}
            disabled={index === total - 1}
            aria-label={`Move ${label} down`}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${label}`}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Colour name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={variant.name}
            maxLength={60}
            onChange={(e) => onChange({ ...variant, name: e.target.value })}
          />
        </Field>
        <Field label="Swatch" htmlFor={`${id}-swatch`} hint="A colour like #E0799C or a CSS gradient.">
          <div className="flex gap-2">
            <input
              type="color"
              aria-label={`Pick ${label} colour`}
              value={HEX_COLOUR.test(variant.swatch) ? variant.swatch : "#000000"}
              onChange={(e) => onChange({ ...variant, swatch: e.target.value.toUpperCase() })}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-sm border border-input bg-transparent p-1"
            />
            <Input
              id={`${id}-swatch`}
              value={variant.swatch}
              maxLength={300}
              onChange={(e) => onChange({ ...variant, swatch: e.target.value })}
            />
          </div>
        </Field>
        <Field label="Availability" htmlFor={`${id}-availability`}>
          <Select
            value={variant.availability}
            onValueChange={(value) => onChange({ ...variant, availability: value as Availability })}
          >
            <SelectTrigger id={`${id}-availability`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABILITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {AVAILABILITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Pictures</span>
        {images.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pictures yet. The first picture shows on product cards.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {images.map((path, imageIndex) => (
              <li key={path} className="grid w-24 gap-1">
                <img
                  src={mediaUrl(imageBase, path)}
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  className="size-24 rounded-sm bg-muted object-cover"
                />
                <div className="flex justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={imageIndex === 0}
                    onClick={() => onChange({ ...variant, images: move(images, imageIndex, imageIndex - 1) })}
                    aria-label={`Move picture ${imageIndex + 1} earlier`}
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onChange({ ...variant, images: images.filter((_, i) => i !== imageIndex) })}
                    aria-label={`Remove picture ${imageIndex + 1}`}
                  >
                    <X />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={imageIndex === images.length - 1}
                    onClick={() => onChange({ ...variant, images: move(images, imageIndex, imageIndex + 1) })}
                    aria-label={`Move picture ${imageIndex + 1} later`}
                  >
                    <ArrowRight />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <PictureUpload
          productId={productId}
          label={label}
          room={MAX_IMAGES_PER_VARIANT - images.length}
          onUploaded={onAddImages}
        />
      </div>
    </li>
  );
}

export function ProductEditor({ product, categories }: { product: AdminProduct | null; categories: AdminCategory[] }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { imageBase } = useCatalog();
  const initial = useMemo(
    () => (product ? productToForm(product) : emptyProductForm(categories[0]?.id)),
    [product, categories],
  );
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [detailsText, setDetailsText] = useState((initial.details ?? []).join("\n"));
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const details = detailsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const current: ProductFormValues = { ...values, details };
  const dirty = JSON.stringify(current) !== JSON.stringify(initial);
  const margin = unitMargin(values.price ?? 0, values.costPrice ?? null);

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setSaved(false);
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  const setVariants = (variants: FormVariant[]) => set("variants", variants);

  // Uploads finish later, so append to the latest state rather than the variants captured at click time.
  function addImages(index: number, keys: string[]) {
    setSaved(false);
    setValues((previous) => ({
      ...previous,
      variants: (previous.variants ?? []).map((variant, i) =>
        i === index
          ? { ...variant, images: [...(variant.images ?? []), ...keys].slice(0, MAX_IMAGES_PER_VARIANT) }
          : variant,
      ),
    }));
  }

  const save = useMutation({
    mutationFn: (form: ProductFormValues) =>
      saveProductFn({ data: { id: product?.id ?? null, revision: product?.revision ?? "", product: form } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setConflict(Boolean(result.conflict));
        setProblems([result.error]);
        return;
      }
      setProblems([]);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });
      if (!product)
        await navigate({ to: "/admin/products/$productId", params: { productId: String(result.id) }, replace: true });
    },
    onError: (error) => setProblems([error.message || "Could not save. Check your connection and try again."]),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setConflict(false);
    const parsed = productInputSchema.safeParse(current);
    if (!parsed.success) {
      setProblems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    setProblems([]);
    save.mutate(current);
  }

  async function reloadLatest() {
    setConflict(false);
    setProblems([]);
    if (product) await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "product", product.id] });
  }

  const variants = values.variants ?? [];

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{product ? product.name : "New product"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {product
              ? `Status: ${STATUS_LABELS[product.status]}`
              : "New products start as drafts and stay hidden until published."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product?.status === "published" ? (
            <Button asChild variant="outline">
              <a href={`/products/${product.slug}`} target="_blank" rel="noreferrer">
                View on shop <ExternalLink />
              </a>
            </Button>
          ) : null}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : product ? "Save changes" : "Create product"}
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {problems.length ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{conflict ? "Not saved: this product changed elsewhere" : "Not saved"}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              {conflict ? (
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={reloadLatest}>
                  Reload latest (discards your edits)
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {saved && !dirty ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        {dirty && !save.isPending ? <p className="text-sm text-muted-foreground">You have unsaved changes.</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={values.name}
              maxLength={120}
              onChange={(e) => {
                const name = e.target.value;
                setSaved(false);
                setValues((previous) => ({ ...previous, name, slug: slugTouched ? previous.slug : slugify(name) }));
              }}
            />
          </Field>
          <Field
            label="URL name"
            htmlFor={`${id}-slug`}
            hint={`cavarabd.com/products/${values.slug || "…"}. Changing it breaks old links.`}
          >
            <Input
              id={`${id}-slug`}
              value={values.slug}
              maxLength={80}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field label="Category" htmlFor={`${id}-category`}>
            <Select value={values.categoryId} onValueChange={(value) => set("categoryId", value)}>
              <SelectTrigger id={`${id}-category`} className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" htmlFor={`${id}-status`} hint="Only published products appear on the shop.">
            <Select
              value={values.status}
              onValueChange={(value) => set("status", value as ProductFormValues["status"])}
            >
              <SelectTrigger id={`${id}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Summary" htmlFor={`${id}-summary`} hint="One or two sentences under the product name.">
              <Textarea
                id={`${id}-summary`}
                value={values.summary}
                maxLength={500}
                rows={3}
                onChange={(e) => set("summary", e.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Details" htmlFor={`${id}-details`} hint={`One point per line, up to ${MAX_DETAILS}.`}>
              <Textarea
                id={`${id}-details`}
                value={detailsText}
                rows={4}
                onChange={(e) => {
                  setSaved(false);
                  setDetailsText(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Note" htmlFor={`${id}-note`} hint="Optional short note, e.g. care instructions.">
              <Input
                id={`${id}-note`}
                value={values.note ?? ""}
                maxLength={300}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price</CardTitle>
          <CardDescription>Whole taka. Cost price is private and only used for profit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (৳)" htmlFor={`${id}-price`}>
            <Input
              id={`${id}-price`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={values.price ? String(values.price) : ""}
              onChange={(e) => set("price", toTaka(e.target.value) ?? 0)}
            />
          </Field>
          <Field label="Regular price (৳)" htmlFor={`${id}-regular`} hint="Optional. Not shown on the shop yet.">
            <Input
              id={`${id}-regular`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={values.regularPrice ?? ""}
              onChange={(e) => set("regularPrice", toTaka(e.target.value))}
            />
          </Field>
          <Field
            label="Cost price (৳)"
            htmlFor={`${id}-cost`}
            hint={margin === null ? "Optional. Needed for profit." : `Margin ${formatPrice(margin)} per item.`}
          >
            <Input
              id={`${id}-cost`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={values.costPrice ?? ""}
              onChange={(e) => set("costPrice", toTaka(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Colours</CardTitle>
          <CardDescription>
            Shoppers' saved bags remember a colour by its place in this list, so reordering or removing colours can
            change the colour in a bag that is already saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No colours yet. A product needs one to be published.</p>
          ) : null}
          <ul className="grid gap-4">
            {variants.map((variant, index) => (
              <VariantCard
                key={variant.id ?? `new-${index}`}
                variant={variant}
                index={index}
                total={variants.length}
                onChange={(next) => setVariants(variants.map((item, i) => (i === index ? next : item)))}
                onMove={(to) => setVariants(move(variants, index, to))}
                onRemove={() => setVariants(variants.filter((_, i) => i !== index))}
                onAddImages={(keys) => addImages(index, keys)}
                productId={product ? String(product.id) : "new"}
                imageBase={imageBase}
              />
            ))}
          </ul>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={variants.length >= MAX_VARIANTS}
              onClick={() =>
                setVariants([
                  ...variants,
                  { id: null, name: "", swatch: "#E7E9E8", availability: "in_stock", images: [] },
                ])
              }
            >
              <Plus /> Add colour
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Sort order" htmlFor={`${id}-sort`} hint="Lower numbers come first on the shop.">
            <Input
              id={`${id}-sort`}
              type="number"
              inputMode="numeric"
              step={1}
              value={String(values.sort ?? 0)}
              onChange={(e) => set("sort", toTaka(e.target.value) ?? 0)}
            />
          </Field>
          <div className="flex items-center gap-2 self-center">
            <Checkbox
              id={`${id}-featured`}
              checked={values.featured}
              onCheckedChange={(checked) => set("featured", checked === true)}
            />
            <Label htmlFor={`${id}-featured`}>Featured</Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : product ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}

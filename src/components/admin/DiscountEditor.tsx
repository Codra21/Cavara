import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pencil,
  Percent,
  Plus,
  Power,
  PowerOff,
  Save,
  XCircle,
} from "lucide-react";
import { useId, useState } from "react";
import {
  type AdminDiscount,
  type DiscountInput,
  discountInputSchema,
  discountLabel,
  dhakaLocalToIso,
  DISCOUNT_SCOPES,
  type DiscountScope,
  type DiscountType,
  isoToDhakaLocal,
  SALE_STATE_LABELS,
  saleState,
  SCOPE_LABELS,
} from "@/domain/discounts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveDiscountFn } from "@/server/functions/admin-discounts.functions";
import { adminTimeFormat } from "./ActivityLog";
import { adminCategoriesQuery, adminProductNamesQuery, ADMIN_QUERY_KEY } from "./queries";

interface Draft {
  id: number | null;
  revision: string;
  name: string;
  scope: DiscountScope;
  categoryId: string | null;
  productId: number | null;
  /** Shown while a product is chosen. */
  productName: string;
  type: DiscountType;
  value: string;
  /** `YYYY-MM-DDTHH:mm` in Asia/Dhaka, as a datetime-local field holds it. */
  startsAt: string;
  endsAt: string;
  active: boolean;
}

const newDraft = (): Draft => ({
  id: null,
  revision: "",
  name: "",
  scope: "all",
  categoryId: null,
  productId: null,
  productName: "",
  type: "percent",
  value: "",
  startsAt: isoToDhakaLocal(new Date().toISOString()),
  endsAt: "",
  active: true,
});

const toDraft = (discount: AdminDiscount): Draft => ({
  id: discount.id,
  revision: discount.revision,
  name: discount.name,
  scope: discount.scope,
  categoryId: discount.categoryId,
  productId: discount.productId,
  productName: discount.scope === "product" ? (discount.targetName ?? "") : "",
  type: discount.type,
  value: String(discount.value),
  startsAt: isoToDhakaLocal(discount.startsAt),
  endsAt: discount.endsAt ? isoToDhakaLocal(discount.endsAt) : "",
  active: discount.active,
});

/** The form's text fields as the server schema wants them; the same schema checks both sides. */
const toRequest = (draft: Draft) => ({
  name: draft.name,
  scope: draft.scope,
  categoryId: draft.categoryId,
  productId: draft.productId,
  type: draft.type,
  value: draft.value.trim() === "" ? Number.NaN : Number(draft.value),
  startsAt: dhakaLocalToIso(draft.startsAt) ?? "",
  endsAt: draft.endsAt === "" ? null : (dhakaLocalToIso(draft.endsAt) ?? ""),
  active: draft.active,
});

const fromDiscount = (discount: AdminDiscount, active: boolean): DiscountInput => ({
  name: discount.name,
  scope: discount.scope,
  categoryId: discount.categoryId,
  productId: discount.productId,
  type: discount.type,
  value: discount.value,
  startsAt: discount.startsAt,
  endsAt: discount.endsAt,
  active,
});

const STATE_META = {
  live: { variant: "success", icon: CheckCircle2 },
  upcoming: { variant: "info", icon: Clock },
  ended: { variant: "outline", icon: XCircle },
  off: { variant: "outline", icon: PowerOff },
} as const;

/** Owner-only sales: list, add, edit and switch off. Sales are never deleted (orders keep the id of the sale). */
export function DiscountEditor({ discounts }: { discounts: AdminDiscount[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  // A save can succeed with a warning from the server; it gets the warning style, not the success one.
  const [notice, setNotice] = useState<{ text: string; warning: boolean } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (data: { id: number | null; revision: string; input: DiscountInput }) => saveDiscountFn({ data }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setProblems([result.error]);
        return;
      }
      setProblems([]);
      setDraft(null);
      setNotice(
        "warning" in result && result.warning
          ? { text: result.warning, warning: true }
          : { text: `Saved ${result.discount.name}. The shop shows the new prices now.`, warning: false },
      );
      await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "discounts"] });
      await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] });
    },
    onError: (error) => setProblems([error.message || "Could not save. Try again."]),
  });

  const now = Date.now();
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A sale lowers the price of every product, one category or one product between two dates. When several apply
            to a product, the lowest price wins; they do not stack.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setNotice(null);
            setProblems([]);
            setDraft(newDraft());
          }}
          disabled={draft !== null && draft.id === null}
        >
          <Plus /> Add sale
        </Button>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {problems.length && !draft ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{problems.join(" ")}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant={notice.warning ? "warning" : "success"} role="status">
            {notice.warning ? <AlertTriangle /> : <CheckCircle2 />}
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {draft ? (
        <DiscountForm
          key={`${draft.id ?? "new"}:${draft.revision}`}
          initial={draft}
          pending={save.isPending}
          problems={problems}
          onProblems={setProblems}
          onCancel={() => {
            setProblems([]);
            setDraft(null);
          }}
          onSubmit={(data) => save.mutate(data)}
        />
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          {discounts.length === 0 ? (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Percent className="size-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-foreground">No sales yet</p>
              <p className="text-xs text-muted-foreground">Add a sale to run a timed promotion on the storefront.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Sale</TableHead>
                  <TableHead className="hidden sm:table-cell">Covers</TableHead>
                  <TableHead className="hidden md:table-cell">Runs</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map((discount) => {
                  const state = saleState(discount, now);
                  const { variant, icon: StateIcon } = STATE_META[state];
                  return (
                    <TableRow key={discount.id}>
                      <TableCell className="max-w-[14rem] whitespace-normal pl-4">
                        <div className="font-medium text-foreground">{discount.name}</div>
                        <div className="text-xs font-medium text-primary">{discountLabel(discount)}</div>
                        {/* Phones have no room for a Status column, so the badge sits under the name. */}
                        <Badge variant={variant} className="mt-1 sm:hidden">
                          <StateIcon aria-hidden="true" />
                          {SALE_STATE_LABELS[state]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal sm:table-cell">
                        {discount.scope === "all"
                          ? SCOPE_LABELS.all
                          : (discount.targetName ?? SCOPE_LABELS[discount.scope])}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal text-xs text-muted-foreground md:table-cell">
                        {adminTimeFormat.format(new Date(discount.startsAt))}
                        <br />
                        {discount.endsAt ? `to ${adminTimeFormat.format(new Date(discount.endsAt))}` : "No end date"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={variant}>
                          <StateIcon aria-hidden="true" />
                          {SALE_STATE_LABELS[state]}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setNotice(null);
                            setProblems([]);
                            setDraft(toDraft(discount));
                          }}
                        >
                          <Pencil /> Edit<span className="sr-only"> {discount.name}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={save.isPending}
                          onClick={() => {
                            setNotice(null);
                            save.mutate({
                              id: discount.id,
                              revision: discount.revision,
                              input: fromDiscount(discount, !discount.active),
                            });
                          }}
                        >
                          {discount.active ? <PowerOff /> : <Power />}
                          {discount.active ? "Switch off" : "Switch on"}
                          <span className="sr-only"> {discount.name}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiscountForm({
  initial,
  pending,
  problems,
  onProblems,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  pending: boolean;
  problems: string[];
  onProblems: (problems: string[]) => void;
  onCancel: () => void;
  onSubmit: (data: { id: number | null; revision: string; input: DiscountInput }) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(initial);
  const [productSearch, setProductSearch] = useState("");
  const categories = useQuery({ ...adminCategoriesQuery(), enabled: draft.scope === "category" });
  const names = useQuery({ ...adminProductNamesQuery(), enabled: draft.scope === "product" });

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const terms = productSearch.toLowerCase().split(/\s+/).filter(Boolean);
  const matches =
    terms.length === 0
      ? []
      : (names.data ?? [])
          .filter(
            (product) =>
              product.status !== "archived" && terms.every((term) => product.name.toLowerCase().includes(term)),
          )
          .slice(0, 8);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = discountInputSchema.safeParse(toRequest(draft));
    if (!parsed.success) {
      onProblems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    onProblems([]);
    onSubmit({ id: draft.id, revision: draft.revision, input: parsed.data });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>{draft.id === null ? "Add a sale" : "Edit sale"}</CardTitle>
          <CardDescription>
            Times are Bangladesh time. Orders already placed keep the price they were charged.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {problems.length ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={draft.name}
              maxLength={80}
              placeholder="Eid sale"
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-scope`}>Covers</Label>
              <Select
                value={draft.scope}
                onValueChange={(value) =>
                  set({ scope: value as DiscountScope, categoryId: null, productId: null, productName: "" })
                }
              >
                <SelectTrigger id={`${id}-scope`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {SCOPE_LABELS[scope]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draft.scope === "category" ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-category`}>Category</Label>
                <Select value={draft.categoryId ?? ""} onValueChange={(value) => set({ categoryId: value })}>
                  <SelectTrigger id={`${id}-category`} className="w-full">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories.data ?? []).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {draft.scope === "product" ? (
              <div className="grid gap-1.5">
                {draft.productId !== null ? (
                  <span className="text-sm leading-none font-medium">Product</span>
                ) : (
                  <Label htmlFor={`${id}-product`}>Product</Label>
                )}
                {draft.productId !== null ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate">{draft.productName || `Product ${draft.productId}`}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        set({ productId: null, productName: "" });
                        setProductSearch("");
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      id={`${id}-product`}
                      value={productSearch}
                      placeholder="Search products by name"
                      autoComplete="off"
                      onChange={(event) => setProductSearch(event.target.value)}
                    />
                    {names.isPending ? <p className="text-xs text-muted-foreground">Loading products…</p> : null}
                    {matches.length ? (
                      <ul className="grid gap-1" aria-label="Matching products">
                        {matches.map((product) => (
                          <li key={product.id}>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => set({ productId: product.id, productName: product.name })}
                            >
                              {product.name}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : terms.length && names.data ? (
                      <p className="text-xs text-muted-foreground">No product matches.</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-type`}>Takes off</Label>
              <Select value={draft.type} onValueChange={(value) => set({ type: value as DiscountType })}>
                <SelectTrigger id={`${id}-type`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">A percentage</SelectItem>
                  <SelectItem value="amount">A fixed amount (৳)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-value`}>{draft.type === "percent" ? "Percent off" : "Taka off"}</Label>
              <Input
                id={`${id}-value`}
                type="number"
                inputMode="numeric"
                min={1}
                max={draft.type === "percent" ? 99 : undefined}
                step={1}
                value={draft.value}
                onChange={(event) => set({ value: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {draft.type === "percent"
                  ? "Rounded down to whole taka per piece."
                  : "Taken off each piece. A piece never costs less than ৳1."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-starts`}>Starts</Label>
              <Input
                id={`${id}-starts`}
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => set({ startsAt: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-ends`}>Ends</Label>
              <Input
                id={`${id}-ends`}
                type="datetime-local"
                value={draft.endsAt}
                onChange={(event) => set({ endsAt: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Leave empty to run until you switch it off.</p>
            </div>
          </div>

          <div className="flex h-9 items-center gap-2">
            <Checkbox
              id={`${id}-active`}
              checked={draft.active}
              onCheckedChange={(checked) => set({ active: checked === true })}
            />
            <Label htmlFor={`${id}-active`}>Active</Label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              <Save /> {pending ? "Saving…" : "Save sale"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

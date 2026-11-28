import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Save,
  Ticket,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  type AdminCoupon,
  COUPON_STATE_LABELS,
  type CouponInput,
  couponInputSchema,
  couponState,
} from "@/domain/coupons";
import { dhakaLocalToIso, discountLabel, type DiscountType, isoToDhakaLocal } from "@/domain/discounts";
import { formatPrice } from "@/domain/catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCouponFn } from "@/server/functions/admin-discounts.functions";
import { adminTimeFormat } from "./ActivityLog";
import { ADMIN_QUERY_KEY } from "./queries";

interface Draft {
  id: number | null;
  revision: string;
  name: string;
  code: string;
  type: DiscountType;
  value: string;
  minOrder: string;
  maxDiscount: string;
  usageLimit: string;
  /** `YYYY-MM-DDTHH:mm` in Asia/Dhaka, as a datetime-local field holds it. */
  startsAt: string;
  endsAt: string;
  active: boolean;
}

const newDraft = (): Draft => ({
  id: null,
  revision: "",
  name: "",
  code: "",
  type: "percent",
  value: "",
  minOrder: "",
  maxDiscount: "",
  usageLimit: "",
  startsAt: isoToDhakaLocal(new Date().toISOString()),
  endsAt: "",
  active: true,
});

const toDraft = (coupon: AdminCoupon): Draft => ({
  id: coupon.id,
  revision: coupon.revision,
  name: coupon.name,
  code: coupon.code,
  type: coupon.type,
  value: String(coupon.value),
  minOrder: coupon.minOrder === null ? "" : String(coupon.minOrder),
  maxDiscount: coupon.maxDiscount === null ? "" : String(coupon.maxDiscount),
  usageLimit: coupon.usageLimit === null ? "" : String(coupon.usageLimit),
  startsAt: isoToDhakaLocal(coupon.startsAt),
  endsAt: coupon.endsAt ? isoToDhakaLocal(coupon.endsAt) : "",
  active: coupon.active,
});

/** An empty field means "no limit"; anything else is parsed so the shared schema can name what is wrong with it. */
const optionalNumber = (text: string) => (text.trim() === "" ? null : Number(text));

/** The form's text fields as the server schema wants them; the same schema checks both sides. */
const toRequest = (draft: Draft) => ({
  name: draft.name,
  code: draft.code,
  type: draft.type,
  value: draft.value.trim() === "" ? Number.NaN : Number(draft.value),
  minOrder: optionalNumber(draft.minOrder),
  maxDiscount: draft.type === "percent" ? optionalNumber(draft.maxDiscount) : null,
  usageLimit: optionalNumber(draft.usageLimit),
  startsAt: dhakaLocalToIso(draft.startsAt) ?? "",
  endsAt: draft.endsAt === "" ? null : (dhakaLocalToIso(draft.endsAt) ?? ""),
  active: draft.active,
});

const fromCoupon = (coupon: AdminCoupon, active: boolean): CouponInput => ({
  name: coupon.name,
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  minOrder: coupon.minOrder,
  maxDiscount: coupon.maxDiscount,
  usageLimit: coupon.usageLimit,
  startsAt: coupon.startsAt,
  endsAt: coupon.endsAt,
  active,
});

const STATE_META = {
  live: { variant: "success", icon: CheckCircle2 },
  upcoming: { variant: "info", icon: Clock },
  ended: { variant: "outline", icon: XCircle },
  off: { variant: "outline", icon: PowerOff },
  used_up: { variant: "warning", icon: AlertTriangle },
} as const;

/** Owner-only coupons: list with use counts, add, edit and switch off. Never deleted (orders keep the code). */
export function CouponEditor({ coupons }: { coupons: AdminCoupon[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({
      source: _source,
      ...data
    }: {
      id: number | null;
      revision: string;
      input: CouponInput;
      source: "form" | "toggle";
    }) => saveCouponFn({ data }),
    onSuccess: async (result, variables) => {
      if (!result.ok) {
        if (variables.source === "toggle") setToggleError(result.error);
        else setProblems([result.error]);
        if ("conflict" in result && result.conflict) {
          await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "coupons"] });
        }
        return;
      }
      if (variables.source === "toggle") {
        setToggleError(null);
        setDraft((current) =>
          current && current.id === result.coupon.id
            ? { ...current, revision: result.coupon.revision, active: result.coupon.active }
            : current,
        );
      } else {
        setProblems([]);
        setDraft(null);
      }
      setNotice(`Saved ${result.coupon.code}.`);
      await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "coupons"] });
      await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] });
    },
    onError: (error, variables) => {
      const msg = error.message || "Could not save. Try again.";
      if (variables.source === "toggle") setToggleError(msg);
      else setProblems([msg]);
    },
  });

  const now = Date.now();
  return (
    <section className="grid gap-6" aria-labelledby="coupons-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="coupons-heading" className="text-2xl font-bold tracking-tight">
            Coupons
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A coupon is a code the shopper types at checkout. It takes money off the item total after any sale prices,
            once per order. Cancelling an unpaid order gives its use back; reopening it takes the use again.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setNotice(null);
            setProblems([]);
            setDraft(newDraft());
            setFormKey((n) => n + 1);
          }}
          disabled={draft !== null && draft.id === null}
        >
          <Plus /> Add coupon
        </Button>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {toggleError ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{toggleError}</AlertDescription>
          </Alert>
        ) : null}
        {problems.length && !draft ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{problems.join(" ")}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="success" role="status">
            <CheckCircle2 />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {draft ? (
        <CouponForm
          key={`${draft.id ?? "new"}:${formKey}`}
          initial={draft}
          pending={save.isPending}
          problems={problems}
          onProblems={setProblems}
          onCancel={() => {
            setProblems([]);
            setDraft(null);
          }}
          onSubmit={(data) => save.mutate({ ...data, source: "form" })}
        />
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          {coupons.length === 0 ? (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Ticket className="size-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-foreground">No coupons yet</p>
              <p className="text-xs text-muted-foreground">Create a code shoppers can enter at checkout.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Coupon</TableHead>
                  <TableHead className="hidden sm:table-cell">Rules</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead className="hidden md:table-cell">Runs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon) => {
                  const state = couponState(coupon, now);
                  const { variant, icon: StateIcon } = STATE_META[state];
                  return (
                    <TableRow key={coupon.id}>
                      <TableCell className="max-w-[14rem] whitespace-normal pl-4">
                        <div className="font-mono font-semibold text-primary tabular-nums">{coupon.code}</div>
                        <div className="text-xs text-muted-foreground">{coupon.name}</div>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal text-xs sm:table-cell">
                        <span className="font-medium text-foreground">{discountLabel(coupon)}</span>
                        {coupon.maxDiscount !== null ? `, up to ${formatPrice(coupon.maxDiscount)}` : ""}
                        {coupon.minOrder ? (
                          <div className="text-muted-foreground">Needs {formatPrice(coupon.minOrder)} in items</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {coupon.usedCount}
                        {coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ""}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal text-xs text-muted-foreground md:table-cell">
                        {adminTimeFormat.format(new Date(coupon.startsAt))}
                        <br />
                        {coupon.endsAt ? `to ${adminTimeFormat.format(new Date(coupon.endsAt))}` : "No end date"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={variant}>
                          <StateIcon aria-hidden="true" />
                          {COUPON_STATE_LABELS[state]}
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
                            setDraft(toDraft(coupon));
                            setFormKey((n) => n + 1);
                          }}
                        >
                          <Pencil /> Edit<span className="sr-only"> {coupon.code}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={save.isPending}
                          onClick={() => {
                            setNotice(null);
                            save.mutate({
                              id: coupon.id,
                              revision: coupon.revision,
                              input: fromCoupon(coupon, !coupon.active),
                              source: "toggle",
                            });
                          }}
                        >
                          {coupon.active ? <PowerOff /> : <Power />}
                          {coupon.active ? "Switch off" : "Switch on"}
                          <span className="sr-only"> {coupon.code}</span>
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
    </section>
  );
}

function CouponForm({
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
  onSubmit: (data: { id: number | null; revision: string; input: CouponInput }) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(initial);
  useEffect(() => {
    setDraft((current) =>
      current.revision === initial.revision
        ? current
        : { ...current, revision: initial.revision, active: initial.active },
    );
  }, [initial.revision, initial.active]);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const editing = draft.id !== null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = couponInputSchema.safeParse(toRequest(draft));
    if (!parsed.success) {
      onProblems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    onProblems([]);
    onSubmit({ id: draft.id, revision: initial.revision, input: parsed.data });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>{editing ? `Edit ${initial.code}` : "Add a coupon"}</CardTitle>
          <CardDescription>
            Times are Bangladesh time. Orders already placed keep the discount they were given.
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={draft.name}
                maxLength={80}
                placeholder="Eid welcome"
                onChange={(event) => set({ name: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-code`}>Code</Label>
              <Input
                id={`${id}-code`}
                value={draft.code}
                maxLength={20}
                placeholder="EID25"
                autoComplete="off"
                disabled={editing}
                className="font-mono uppercase"
                onChange={(event) => set({ code: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "A saved code cannot change. Add a new coupon for a new code."
                  : "3 to 20 letters, digits or hyphens. Shoppers can type it in any case."}
              </p>
            </div>
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
                  ? "Rounded down to whole taka. The order never drops below ৳1."
                  : "Taken off the item total. The order never drops below ৳1."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-min`}>Minimum order (৳)</Label>
              <Input
                id={`${id}-min`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.minOrder}
                onChange={(event) => set({ minOrder: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Item total after sales. Empty for none.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-cap`}>Cap (৳)</Label>
              <Input
                id={`${id}-cap`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.maxDiscount}
                disabled={draft.type !== "percent"}
                onChange={(event) => set({ maxDiscount: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Most a percent coupon takes off. Empty for none.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-limit`}>Total uses</Label>
              <Input
                id={`${id}-limit`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.usageLimit}
                onChange={(event) => set({ usageLimit: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Across all shoppers. Empty for no limit.</p>
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
              <Save /> {pending ? "Saving…" : "Save coupon"}
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

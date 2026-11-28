import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, MapPin, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { type AdminZone, DEFAULT_PER_KG_CHARGE, saveZonesSchema, type ZoneInput, zonesRevision } from "@/domain/orders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveZonesFn } from "@/server/functions/admin-orders.functions";
import { ADMIN_QUERY_KEY } from "./queries";

type Row = Omit<ZoneInput, "charge" | "perKgCharge"> & { charge: string; perKgCharge: string; key: string };

const toRows = (zones: AdminZone[]): Row[] =>
  zones.map((zone) => ({
    key: zone.id,
    id: zone.id,
    name: zone.name,
    charge: String(zone.charge),
    perKgCharge: String(zone.perKgCharge ?? DEFAULT_PER_KG_CHARGE),
    active: zone.active,
  }));

const serializeRows = (rows: Row[]) => JSON.stringify(rows.map(({ key: _key, ...row }) => row));

/** Owner-only list of delivery areas: rename, re-price, reorder, add, switch off. Areas are never deleted. */
export function ZoneEditor({ zones }: { zones: AdminZone[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<Row[]>(() => toRows(zones));
  const [rows, setRows] = useState<Row[]>(() => toRows(zones));
  const [revision, setRevision] = useState<string>(() => zonesRevision(zones));
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; warning: boolean } | null>(null);
  const dirty = serializeRows(rows) !== serializeRows(baseline);

  useEffect(() => {
    if (dirty) return;
    const next = toRows(zones);
    const nextRevision = zonesRevision(zones);
    if (serializeRows(next) === serializeRows(baseline) && nextRevision === revision) return;
    setRows(next);
    setBaseline(next);
    setRevision(nextRevision);
  }, [zones, dirty, baseline, revision]);
  const firstActiveIndex = rows.findIndex((row) => row.active);

  const update = (index: number, patch: Partial<Row>) => {
    setNotice(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const move = (index: number, to: number) =>
    setRows((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(to, 0, row!);
      return next;
    });

  const save = useMutation({
    mutationFn: (input: { zones: ZoneInput[]; expectedRevision: string }) => saveZonesFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setProblems([result.error]);
        if (result.conflict) {
          await queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "zones"] });
        }
        return;
      }
      setProblems([]);
      const warning = Boolean("warning" in result && result.warning);
      setNotice({
        text: "warning" in result && result.warning ? result.warning : "Saved. Checkout uses the new charges now.",
        warning,
      });
      const saved = toRows(result.zones);
      setRows(saved);
      setBaseline(saved);
      setRevision(result.revision ?? zonesRevision(result.zones));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "zones"] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] }),
      ]);
    },
    onError: (error) => setProblems([error.message || "Could not save. Try again."]),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const input = rows.map((row) => ({
      id: row.id,
      name: row.name,
      charge: row.charge.trim() === "" ? Number.NaN : Number(row.charge),
      perKgCharge: row.perKgCharge.trim() === "" ? Number.NaN : Number(row.perKgCharge),
      active: row.active,
    }));
    const parsed = saveZonesSchema.safeParse({ zones: input, expectedRevision: revision });
    if (!parsed.success) {
      setProblems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    setProblems([]);
    save.mutate({ zones: parsed.data.zones, expectedRevision: revision });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Delivery areas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Charges shown at checkout, in whole taka. Placed orders keep the charge they were placed with.
          </p>
        </div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          <Save /> {save.isPending ? "Saving…" : "Save areas"}
        </Button>
      </div>

      <div aria-live="polite" className="grid gap-2">
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
        {notice && !dirty ? (
          <Alert variant={notice.warning ? "warning" : "success"} role="status">
            <CheckCircle2 />
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="size-4 text-primary" />
            <CardTitle>Areas</CardTitle>
          </div>
          <CardDescription>
            The first active area is selected by default at checkout. Switch an area off to hide it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className={`grid items-end gap-3 rounded-md border p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_auto_auto] ${
                  row.active ? "border-border bg-card" : "border-border/60 bg-muted/40 opacity-75"
                }`}
              >
                <div className="grid gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${id}-${row.key}-name`}>Name</Label>
                    {index === firstActiveIndex ? <Badge variant="info">Default at checkout</Badge> : null}
                    {!row.active ? <Badge variant="outline">Hidden</Badge> : null}
                  </div>
                  <Input
                    id={`${id}-${row.key}-name`}
                    value={row.name}
                    maxLength={60}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-${row.key}-charge`}>Base, first kg (৳)</Label>
                  <Input
                    id={`${id}-${row.key}-charge`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={row.charge}
                    onChange={(event) => update(index, { charge: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-${row.key}-perkg`}>Extra kg (৳)</Label>
                  <Input
                    id={`${id}-${row.key}-perkg`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={row.perKgCharge}
                    onChange={(event) => update(index, { perKgCharge: event.target.value })}
                  />
                </div>
                <div className="flex h-8 items-center gap-2">
                  <Checkbox
                    id={`${id}-${row.key}-active`}
                    checked={row.active}
                    onCheckedChange={(checked) => update(index, { active: checked === true })}
                  />
                  <Label htmlFor={`${id}-${row.key}-active`}>Active</Label>
                </div>
                <div className="flex h-8 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={`Move ${row.name || "area"} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={`Move ${row.name || "area"} down`}
                  >
                    <ArrowDown />
                  </Button>
                  {row.id === null ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      aria-label={`Remove ${row.name || "unsaved area"}`}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            disabled={rows.length >= 20}
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  id: null,
                  name: "",
                  charge: "",
                  perKgCharge: String(DEFAULT_PER_KG_CHARGE),
                  active: true,
                },
              ])
            }
          >
            <Plus /> Add area
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

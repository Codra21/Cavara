import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ShieldBan, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { MAX_BLOCK_REASON } from "@/domain/blocked-phones";
import { formatPhone } from "@/domain/orders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { blockPhoneFn, unblockPhoneFn } from "@/server/functions/admin-blocked-phones.functions";
import { ActionDialog } from "./ActionDialog";
import { ADMIN_QUERY_KEY, adminPhoneBlockedQuery } from "./queries";

/** Owner-only card on the order page: stop new orders from this customer's number, or lift the block. */
export function BlockPhoneCard({ phone, orderId }: { phone: string; orderId: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const status = useQuery(adminPhoneBlockedQuery(phone));
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const done = async () => {
    setOpen(false);
    setReason("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "blocked-phones"] }),
      queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "phone-blocked"] }),
      queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] }),
    ]);
  };
  const block = useMutation({
    mutationFn: () => blockPhoneFn({ data: { phone, reason, orderId } }),
    onSuccess: done,
    onError: (error) => {
      setOpen(false);
      setProblem(error.message || "Could not block this number. Try again.");
    },
  });
  const unblock = useMutation({
    mutationFn: () => unblockPhoneFn({ data: { phone } }),
    onSuccess: done,
    onError: (error) => setProblem(error.message || "Could not unblock this number. Try again."),
  });

  // Until the answer arrives (or if it fails) show nothing rather than a button that could be wrong.
  if (!status.data) return null;
  const blocked = status.data.blocked;

  return (
    <Card className={blocked ? "ring-danger-border bg-danger-soft/30" : undefined}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldBan
            aria-hidden="true"
            className={`size-4 ${blocked ? "text-destructive" : "text-muted-foreground"}`}
          />
          <CardTitle>{blocked ? "This number is blocked" : "Block this number"}</CardTitle>
        </div>
        <CardDescription>
          {blocked
            ? "New orders from it are refused. Its existing orders are unchanged."
            : "Refuses new orders from this number. Its existing orders stay as they are."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {problem ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        {blocked ? (
          <Button
            type="button"
            variant="outline"
            disabled={unblock.isPending}
            data-agent-confirm={`Unblocks ${formatPhone(phone)} so it can order again`}
            onClick={() => {
              setProblem(null);
              unblock.mutate();
            }}
          >
            <ShieldCheck />
            {unblock.isPending ? "Unblocking…" : "Unblock"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setProblem(null);
              setOpen(true);
            }}
          >
            <ShieldBan />
            Block this number
          </Button>
        )}
      </CardContent>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Block ${formatPhone(phone)}?`}
        description={`Blocks ${formatPhone(phone)} from placing new orders. Existing orders are not cancelled.`}
        confirmLabel="Block"
        pendingLabel="Blocking…"
        pending={block.isPending}
        destructive
        onConfirm={() => block.mutate()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
          <Input
            id={`${id}-reason`}
            maxLength={MAX_BLOCK_REASON}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Three fake orders in a week"
          />
        </div>
      </ActionDialog>
    </Card>
  );
}

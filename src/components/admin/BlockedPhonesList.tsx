import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { BlockedPhone } from "@/domain/blocked-phones";
import { formatPhone } from "@/domain/orders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { unblockPhoneFn } from "@/server/functions/admin-blocked-phones.functions";
import { adminTimeFormat } from "./ActivityLog";
import { ADMIN_QUERY_KEY } from "./queries";

/** Owner-only list of blocked numbers with an Unblock button. Numbers are blocked from the order page. */
export function BlockedPhonesList({ blocked }: { blocked: BlockedPhone[] }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const unblock = useMutation({
    mutationFn: (phone: string) => unblockPhoneFn({ data: { phone } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY }),
    onError: (error) => setProblem(error.message || "Could not unblock this number. Try again."),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Blocked numbers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An order from a blocked number is refused and nothing is saved. Block a number from its order page.
        </p>
      </div>
      {problem ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
      <Card className="py-0">
        <CardContent className="px-0">
          {blocked.length === 0 ? (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-foreground">No numbers are blocked</p>
              <p className="text-xs text-muted-foreground">
                If you receive spam or fake orders, open the order page to block that number.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Number</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden sm:table-cell">Blocked</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocked.map((entry) => (
                  <TableRow key={entry.phone}>
                    <TableCell className="pl-4 font-medium tabular-nums">{formatPhone(entry.phone)}</TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal text-muted-foreground">
                      {entry.reason || "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {adminTimeFormat.format(new Date(entry.createdAt))} · {entry.createdBy}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={unblock.isPending}
                        aria-label={`Unblock ${formatPhone(entry.phone)}`}
                        data-agent-confirm={`Unblocks ${formatPhone(entry.phone)} so it can order again`}
                        onClick={() => {
                          setProblem(null);
                          unblock.mutate(entry.phone);
                        }}
                      >
                        <ShieldCheck /> Unblock
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

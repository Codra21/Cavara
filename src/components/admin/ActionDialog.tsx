import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A small confirm dialog (ui-sdk AlertDialog: focus is trapped, Escape and the Cancel button close it). */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  destructive,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // The confirm button runs the action and leaves the dialog open until the caller closes it.
        if (details.returnValue === "confirm") {
          details.cancel();
          if (!pending) onConfirm();
          return;
        }
        if (pending) details.cancel();
        else onOpenChange(false);
      }}
    >
      <AlertDialogBackdrop className="fixed inset-0 z-50 bg-foreground/40" />
      <AlertDialogContent className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg bg-popover p-5 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
        <div className="grid gap-1.5">
          <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">{description}</AlertDialogDescription>
        </div>
        {children}
        <div className="flex justify-end gap-2">
          <AlertDialogClose
            render={
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <AlertDialogClose
            value="confirm"
            data-agent-confirm={description || title}
            render={
              <Button type="button" variant={destructive ? "destructive" : "default"} disabled={pending}>
                {pending ? pendingLabel : confirmLabel}
              </Button>
            }
          />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

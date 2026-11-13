import type { ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogContent } from "@ui-sdk/react/dialog";

export function ModalDialog({
  open,
  onClose,
  className,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogBackdrop className="modal-scrim" />
      <DialogContent className={className} aria-labelledby={labelledBy}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

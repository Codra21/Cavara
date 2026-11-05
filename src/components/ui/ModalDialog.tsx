import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/dom";

/**
 * Native <dialog> driven by an `open` prop. Plays the `.is-closing` exit animation from site.css
 * before calling close(), and routes Escape / backdrop clicks to `onClose`.
 */
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
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      dialog.classList.remove("is-closing");
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (!dialog.open) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.classList.remove("is-closing");
      dialog.close();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    dialog.classList.add("is-closing");
    dialog.addEventListener("animationend", finish, { once: true });
    const timer = window.setTimeout(finish, 260);
    return () => {
      window.clearTimeout(timer);
      dialog.removeEventListener("animationend", finish);
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      {children}
    </dialog>
  );
}

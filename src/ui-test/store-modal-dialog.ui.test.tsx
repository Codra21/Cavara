import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ModalDialog } from "@/components/ui/ModalDialog";

const onClose = vi.fn();

function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open bag
      </button>
      <ModalDialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        className="bag-drawer"
        labelledBy="bag-title"
      >
        <h2 id="bag-title">Your bag</h2>
        <button type="button">Checkout</button>
      </ModalDialog>
    </>
  );
}

afterEach(() => onClose.mockClear());

test("opens when open turns true and is named by its heading", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.queryByRole("dialog")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Open bag" }));

  const dialog = await screen.findByRole("dialog", { name: "Your bag" });
  expect(dialog.classList.contains("bag-drawer")).toBe(true);
  expect(dialog.getAttribute("aria-labelledby")).toBe("bag-title");
  expect(dialog.hasAttribute("data-open")).toBe(true);
});

test("Escape calls onClose and focus returns to the opener", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open bag" });
  await user.click(opener);
  await screen.findByRole("dialog");

  await user.keyboard("{Escape}");

  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

test("a press on the backdrop calls onClose", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Harness initiallyOpen />);
  await screen.findByRole("dialog");
  const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-backdrop"]');
  expect(backdrop).not.toBeNull();

  await user.click(backdrop!);

  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a press inside the dialog does not call onClose", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Harness initiallyOpen />);
  await user.click(await screen.findByRole("button", { name: "Checkout" }));
  await user.click(screen.getByRole("heading", { name: "Your bag" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("the open prop alone closes it again", async () => {
  const { rerender } = render(
    <ModalDialog open onClose={onClose} className="product-dialog" labelledBy="t">
      <h2 id="t">Quick view</h2>
    </ModalDialog>,
  );
  await screen.findByRole("dialog", { name: "Quick view" });
  await act(async () => {
    rerender(
      <ModalDialog open={false} onClose={onClose} className="product-dialog" labelledBy="t">
        <h2 id="t">Quick view</h2>
      </ModalDialog>,
    );
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onClose).not.toHaveBeenCalled();
});

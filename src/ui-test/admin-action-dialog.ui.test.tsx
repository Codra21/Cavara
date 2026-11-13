import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ActionDialog } from "@/components/admin/ActionDialog";

afterEach(cleanup);

function Harness({ onConfirm, pending = false }: { onConfirm: () => void; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open archive
      </button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive 2 products?"
        description="Archived products leave the shop."
        confirmLabel="Archive now"
        pendingLabel="Archiving…"
        pending={pending}
        destructive
        onConfirm={onConfirm}
      >
        <p>Extra content</p>
      </ActionDialog>
    </>
  );
}

test("Cancel closes the dialog without confirming and focus returns to the trigger", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<Harness onConfirm={onConfirm} />);

  const trigger = screen.getByRole("button", { name: "Open archive" });
  await user.click(trigger);
  const dialog = await screen.findByRole("alertdialog", { name: "Archive 2 products?" });
  expect(dialog.textContent).toContain("Archived products leave the shop.");
  expect(dialog.textContent).toContain("Extra content");
  expect(document.activeElement?.textContent).toBe("Cancel");

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(onConfirm).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

test("Escape closes it and Tab stays inside", async () => {
  const user = userEvent.setup();
  render(<Harness onConfirm={vi.fn()} />);

  const trigger = screen.getByRole("button", { name: "Open archive" });
  await user.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  for (let press = 0; press < 4; press++) {
    await user.tab();
    expect(dialog.contains(document.activeElement), `Tab ${press + 1} left the dialog`).toBe(true);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("Confirm runs the action once and leaves the dialog for the caller to close", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<Harness onConfirm={onConfirm} />);

  await user.click(screen.getByRole("button", { name: "Open archive" }));
  await screen.findByRole("alertdialog");
  await user.click(screen.getByRole("button", { name: "Archive now" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
});

test("while pending it shows the pending label, disables both buttons and ignores Escape and Confirm", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const { rerender } = render(<Harness onConfirm={onConfirm} />);
  await user.click(screen.getByRole("button", { name: "Open archive" }));
  await screen.findByRole("alertdialog");

  rerender(<Harness onConfirm={onConfirm} pending />);
  const confirm = screen.getByRole("button", { name: "Archiving…" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);

  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await user.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("only the confirming button is marked for a person, with what it does", async () => {
  const user = userEvent.setup();
  render(<Harness onConfirm={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Open archive" }));
  await screen.findByRole("alertdialog");

  expect(screen.getByRole("button", { name: "Archive now" }).getAttribute("data-agent-confirm")).toBe(
    "Archived products leave the shop.",
  );
  expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("data-agent-confirm")).toBe(false);
  expect(screen.getByRole("alertdialog").hasAttribute("data-agent-confirm")).toBe(false);
});

test("pressing outside the dialog leaves it open", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Harness onConfirm={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Open archive" }));
  await screen.findByRole("alertdialog");

  await user.click(document.body);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
});

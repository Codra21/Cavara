import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminProductSummary } from "@/domain/product-admin";

const bulkProductActionFn = vi.hoisted(() => vi.fn());
const duplicateProductFn = vi.hoisted(() => vi.fn());

vi.mock("@/server/functions/admin-catalog.functions", () => ({
  bulkProductActionFn,
  duplicateProductFn,
}));
vi.mock("@/components/admin/queries", () => ({
  patchProductNames: vi.fn(),
  invalidateProductData: vi.fn(async () => {}),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const { BulkBar, DuplicateDialog } = await import("@/components/admin/ProductActions");

const categories = [
  { id: "tableware", name: "Tableware" },
  { id: "drinkware", name: "Drinkware" },
  { id: "decor", name: "Decor" },
];

const row = (id: number, name: string): AdminProductSummary => ({
  id,
  slug: name.toLowerCase(),
  name,
  categoryId: "tableware",
  price: 500,
  costPrice: null,
  status: "published",
  featured: false,
  sort: id,
  variantCount: 1,
  outOfStockColours: 0,
  lowStockColours: 0,
  thumbnail: null,
  updatedAt: "2026-11-01T00:00:00Z",
});

const selected = [row(1, "Bowl"), row(2, "Plate")];

function Harness() {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <BulkBar selected={selected} categories={categories} onClear={() => {}} onNotice={() => {}} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  bulkProductActionFn.mockReset();
  duplicateProductFn.mockReset();
  bulkProductActionFn.mockResolvedValue({ ok: true, applied: [1, 2], skipped: [], shopIds: [1, 2] });
});
afterEach(cleanup);

test("the category Select changes its value with the keyboard and the form sees it", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const move = screen.getByRole("button", { name: "Move" });
  expect((move as HTMLButtonElement).disabled).toBe(true);

  const trigger = screen.getByRole("combobox", { name: "Category to move the selected products to" });
  expect(trigger.textContent).toContain("Move to category");
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await user.keyboard("{ArrowDown}{Enter}");

  await waitFor(() => expect(trigger.textContent).toContain("Drinkware"));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect((move as HTMLButtonElement).disabled).toBe(false);

  await user.click(move);
  expect(bulkProductActionFn).toHaveBeenCalledWith({
    data: { action: "set_category", ids: [1, 2], categoryId: "drinkware" },
  });
});

test("Cancel closes the archive dialog without archiving and returns focus to Archive", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const archive = screen.getByRole("button", { name: "Archive" });
  await user.click(archive);
  const dialog = await screen.findByRole("alertdialog", { name: "Archive 2 products?" });
  expect(dialog.getAttribute("aria-describedby")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(bulkProductActionFn).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(archive);
});

test("Escape closes the archive dialog and returns focus to Archive", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const archive = screen.getByRole("button", { name: "Archive" });
  await user.click(archive);
  await screen.findByRole("alertdialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(archive);
});

test("Archive in the dialog sends the action once and the dialog closes when the caller says so", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Archive" }));
  const dialog = await screen.findByRole("alertdialog");
  const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Archive")!;
  await user.click(confirm);

  expect(bulkProductActionFn).toHaveBeenCalledTimes(1);
  expect(bulkProductActionFn).toHaveBeenCalledWith({ data: { action: "archive", ids: [1, 2] } });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

test("an agent finds the bar's controls, and archiving needs a person", async () => {
  let approve = false;
  const agent = createAgent({ allow: (step) => !step.confirm || approve });
  render(<Harness />);

  const entries = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of entries) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const labels = entries.map((entry) => entry.label);
  for (const label of [
    "Publish",
    "Unpublish",
    "Archive",
    "Feature",
    "Category to move the selected products to",
    "Move",
  ]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }

  const category = await agent.act({
    steps: [{ ref: "Category to move the selected products to", action: "setValue", args: ["Decor"] }],
  });
  expect(category.ok, category.error?.message).toBe(true);
  expect(screen.getByRole("combobox", { name: "Category to move the selected products to" }).textContent).toContain(
    "Decor",
  );

  const opened = await agent.act({ steps: [{ ref: "Archive", action: "press" }] });
  expect(opened.ok, opened.error?.message).toBe(true);
  await screen.findByRole("alertdialog", { name: "Archive 2 products?" });

  const confirm = { steps: [{ ref: "Archive 2 products?", action: "press", args: ["Archive"] }] };
  const refused = await agent.act(confirm);
  expect(refused.ok).toBe(false);
  expect(refused.error?.message).toContain("said no");
  expect(bulkProductActionFn).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeTruthy();

  approve = true;
  const allowed = await agent.act(confirm);
  expect(allowed.ok, allowed.error?.message).toBe(true);
  expect(bulkProductActionFn).toHaveBeenCalledTimes(1);
  expect(bulkProductActionFn).toHaveBeenCalledWith({ data: { action: "archive", ids: [1, 2] } });
});

test("Copy pictures toggles with Space and the Duplicate button sends the choice", async () => {
  const user = userEvent.setup();
  duplicateProductFn.mockResolvedValue({ ok: false, error: "Could not copy this product." });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DuplicateDialog product={{ id: 7, name: "Orange Bowl" }} onClose={onClose} />
    </QueryClientProvider>,
  );

  const copy = await screen.findByRole("checkbox", { name: "Copy pictures" });
  expect(copy.getAttribute("aria-checked")).toBe("true");
  copy.focus();
  await user.keyboard(" ");
  expect(copy.getAttribute("aria-checked")).toBe("false");
  await user.keyboard(" ");
  expect(copy.getAttribute("aria-checked")).toBe("true");
  await user.keyboard(" ");
  expect(copy.hasAttribute("data-checked")).toBe(false);
  expect(copy.hasAttribute("aria-disabled")).toBe(false);

  await user.click(screen.getByRole("button", { name: "Duplicate" }));
  expect(duplicateProductFn).toHaveBeenCalledWith({ data: { id: 7, includeImages: false } });
  expect((await screen.findByRole("alert")).textContent).toContain("Could not copy this product.");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("DuplicateDialog resets Copy pictures and error when closed and reopened for another product", async () => {
  const user = userEvent.setup();
  duplicateProductFn.mockResolvedValueOnce({ ok: false, error: "Temporary failure" });
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <DuplicateDialog product={{ id: 7, name: "Orange Bowl" }} onClose={() => {}} />
    </QueryClientProvider>,
  );

  const copy = await screen.findByRole("checkbox", { name: "Copy pictures" });
  await user.click(copy);
  expect(copy.getAttribute("aria-checked")).toBe("false");

  await user.click(screen.getByRole("button", { name: "Duplicate" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Temporary failure");

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  rerender(
    <QueryClientProvider client={client}>
      <DuplicateDialog product={null} onClose={() => {}} />
    </QueryClientProvider>,
  );
  rerender(
    <QueryClientProvider client={client}>
      <DuplicateDialog product={{ id: 8, name: "Green Plate" }} onClose={() => {}} />
    </QueryClientProvider>,
  );

  const reopenedCopy = await screen.findByRole("checkbox", { name: "Copy pictures" });
  expect(reopenedCopy.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByRole("alert")).toBeNull();
});

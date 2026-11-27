import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminZone } from "@/domain/orders";

const saveZonesFn = vi.hoisted(() => vi.fn());

vi.mock("@/server/functions/admin-orders.functions", () => ({ saveZonesFn }));
vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] }));

const { ZoneEditor } = await import("@/components/admin/ZoneEditor");

const zones: AdminZone[] = [
  { id: "inside-dhaka", name: "Inside Dhaka", charge: 80, active: true, sort: 1 },
  { id: "outside-dhaka", name: "Outside Dhaka", charge: 130, active: true, sort: 2 },
];

function Harness() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ZoneEditor zones={zones} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  saveZonesFn.mockReset();
  saveZonesFn.mockResolvedValue({ ok: true, zones });
});
afterEach(cleanup);

test("every Active checkbox toggles with Space and enables saving", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const save = screen.getByRole("button", { name: "Save areas" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);

  const active = screen.getAllByRole("checkbox", { name: "Active" });
  expect(active).toHaveLength(2);
  for (const box of active) {
    expect(box.getAttribute("aria-checked")).toBe("true");
    box.focus();
    await user.keyboard(" ");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.hasAttribute("data-checked")).toBe(false);
    expect(box.hasAttribute("aria-disabled")).toBe(false);
  }
  expect(save.disabled).toBe(false);

  active[0]!.focus();
  await user.keyboard(" ");
  expect(active[0]!.getAttribute("aria-checked")).toBe("true");
});

test("typing in a charge saves the new value", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  expect(screen.getAllByLabelText<HTMLInputElement>("Name").map((input) => input.value)).toEqual([
    "Inside Dhaka",
    "Outside Dhaka",
  ]);
  const [charge] = screen.getAllByLabelText<HTMLInputElement>("Charge (৳)");
  expect(charge!.value).toBe("80");
  await user.clear(charge!);
  await user.type(charge!, "95");
  expect(charge!.value).toBe("95");

  await user.click(screen.getByRole("button", { name: "Save areas" }));
  await waitFor(() => expect(saveZonesFn).toHaveBeenCalledTimes(1));
  expect(saveZonesFn.mock.calls[0]![0].data.zones[0]).toMatchObject({ id: "inside-dhaka", charge: 95, active: true });
});

test("an agent can find and change every delivery area control", async () => {
  const agent = createAgent();
  render(<Harness />);

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  }
  const labels = components.map((entry) => entry.label);
  for (const label of ["Name", "Charge (৳)", "Active", "Move Inside Dhaka down", "Save areas", "Add area"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }

  const names = components.filter((entry) => entry.label === "Name");
  const charges = components.filter((entry) => entry.label === "Charge (৳)");
  const actives = components.filter((entry) => entry.label === "Active");
  const result = await agent.act({
    steps: [
      { ref: names[0]!.ref, action: "setValue", args: ["Dhaka city"] },
      { ref: charges[0]!.ref, action: "setValue", args: ["70"] },
      { ref: actives[1]!.ref, action: "toggle" },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);

  expect(screen.getAllByLabelText<HTMLInputElement>("Name")[0]!.value).toBe("Dhaka city");
  expect(screen.getAllByLabelText<HTMLInputElement>("Charge (৳)")[0]!.value).toBe("70");
  expect(screen.getAllByRole("checkbox", { name: "Active" })[1]!.getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Save areas" }) as HTMLButtonElement).disabled).toBe(false);
});

test("a background refetch updates clean rows without marking the form dirty", () => {
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <ZoneEditor zones={zones} />
    </QueryClientProvider>,
  );

  expect((screen.getByRole("button", { name: "Save areas" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByLabelText<HTMLInputElement>("Charge (৳)")[0]!.value).toBe("80");

  const refetched: AdminZone[] = [{ ...zones[0]!, charge: 110 }, zones[1]!];
  rerender(
    <QueryClientProvider client={client}>
      <ZoneEditor zones={refetched} />
    </QueryClientProvider>,
  );

  expect(screen.getAllByLabelText<HTMLInputElement>("Charge (৳)")[0]!.value).toBe("110");
  expect((screen.getByRole("button", { name: "Save areas" }) as HTMLButtonElement).disabled).toBe(true);
});

test("an accidentally added unsaved area can be removed without reloading", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Add area" }));
  expect(screen.getAllByLabelText("Name")).toHaveLength(3);

  await user.click(screen.getByRole("button", { name: /Remove/i }));
  expect(screen.getAllByLabelText("Name")).toHaveLength(2);
  expect((screen.getByRole("button", { name: "Save areas" }) as HTMLButtonElement).disabled).toBe(true);
});

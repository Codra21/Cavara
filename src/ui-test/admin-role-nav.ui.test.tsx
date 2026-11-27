import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    activeOptions: _ao,
    activeProps: _ap,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    activeOptions?: unknown;
    activeProps?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/functions/admin-auth.functions", () => ({ signOutFn: vi.fn() }));
vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] }));

const { AdminShell } = await import("@/components/admin/AdminShell");

afterEach(cleanup);

function renderShell(role: "owner" | "staff") {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AdminShell admin={{ id: "1", username: role, role }} onSignedOut={vi.fn()}>
        <p>Body</p>
      </AdminShell>
    </QueryClientProvider>,
  );
}

test("staff navigation hides owner-only Products link while owner sees it", () => {
  renderShell("staff");
  expect(screen.getByRole("link", { name: /Orders/i })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Products/i })).toBeNull();
  cleanup();

  renderShell("owner");
  expect(screen.getByRole("link", { name: /Products/i })).toBeTruthy();
});

test("a failed sign-out keeps cached admin queries intact and shows an alert instead of rejecting", async () => {
  const { signOutFn } = await import("@/server/functions/admin-auth.functions");
  const mockSignOut = vi.mocked(signOutFn);
  mockSignOut.mockRejectedValueOnce(new Error("Network offline"));

  const client = new QueryClient();
  client.setQueryData(["admin", "orders"], [{ id: 1 }]);
  const onSignedOut = vi.fn(async () => {});
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={client}>
      <AdminShell admin={{ id: "1", username: "owner", role: "owner" }} onSignedOut={onSignedOut}>
        <p>Body</p>
      </AdminShell>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: /Sign out/i }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Network offline");
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(client.getQueryData(["admin", "orders"])).toEqual([{ id: 1 }]);
  expect((screen.getByRole("button", { name: /Sign out/i }) as HTMLButtonElement).disabled).toBe(false);
});

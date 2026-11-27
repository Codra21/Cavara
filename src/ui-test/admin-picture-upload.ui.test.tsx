import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const optimizeImage = vi.hoisted(() => vi.fn());
const uploadImageFn = vi.hoisted(() => vi.fn());
const saveProductFn = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  getRouteApi: () => ({ useSearch: () => ({}) }),
}));
vi.mock("@/lib/optimize-image", () => ({ optimizeImage }));
vi.mock("@/lib/query", () => ({ useCategories: () => ({ imageBase: "/media" }) }));
vi.mock("@/server/functions/admin-media.functions", () => ({ uploadImageFn }));
vi.mock("@/server/functions/admin-catalog.functions", () => ({
  saveProductFn,
  listAdminProductsFn: vi.fn(),
  countAdminProductsFn: vi.fn(),
  listAdminCategoriesFn: vi.fn(),
  listProductNamesFn: vi.fn(),
  getAdminProductFn: vi.fn(),
  bulkProductActionFn: vi.fn(),
  duplicateProductFn: vi.fn(),
}));
vi.mock("@/server/functions/admin-blocked-phones.functions", () => ({}));
vi.mock("@/server/functions/admin-stock.functions", () => ({}));
vi.mock("@/server/functions/admin-discounts.functions", () => ({}));
vi.mock("@/server/functions/admin-auth.functions", () => ({}));
vi.mock("@/server/functions/admin-orders.functions", () => ({}));
vi.mock("@/server/functions/admin-dashboard.functions", () => ({}));

const { ProductEditor } = await import("@/components/admin/ProductEditor");

function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  optimizeImage.mockReset().mockImplementation(async (file: File) => ({
    file: new File(["webp"], `${file.name}.webp`, { type: "image/webp" }),
    width: 10,
    height: 10,
    originalBytes: file.size,
  }));
  uploadImageFn.mockReset().mockResolvedValue({ ok: true, key: "k1", bytes: 4, width: 10, height: 10 });
});
afterEach(cleanup);

test("picked pictures go through the optimize and upload pipeline as File objects", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<ProductEditor product={null} categories={[{ id: "tableware", name: "Tableware" }]} />, {
    wrapper: Providers,
  });

  await user.click(screen.getByRole("button", { name: "Add colour" }));
  const trigger = screen.getAllByRole("button", { name: /^Add pictures to / })[0] as HTMLButtonElement;
  expect(trigger.disabled).toBe(false);

  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.multiple).toBe(true);
  expect(input.accept).toContain("image/jpeg");

  const opened = vi.spyOn(input, "click");
  await user.click(trigger);
  expect(opened).toHaveBeenCalledTimes(1);

  const first = new File(["a"], "a.png", { type: "image/png" });
  const second = new File(["b"], "b.png", { type: "image/png" });
  await user.upload(input, [first, second]);

  await waitFor(() => expect(uploadImageFn).toHaveBeenCalledTimes(2));
  expect(optimizeImage.mock.calls.map(([file]) => (file as File).name)).toEqual(["a.png", "b.png"]);
  expect(await screen.findByText(/a\.png: .* → /)).toBeTruthy();

  await user.upload(input, [first]);
  await waitFor(() => expect(uploadImageFn).toHaveBeenCalledTimes(3));
});

test("unsupported picture types show an error instead of being silently dropped", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });
  const { container } = render(<ProductEditor product={null} categories={[{ id: "tableware", name: "Tableware" }]} />, {
    wrapper: Providers,
  });

  await user.click(screen.getByRole("button", { name: "Add colour" }));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const gif = new File(["GIF89a"], "anim.gif", { type: "image/gif" });
  await user.upload(input, [gif]);

  expect(await screen.findByText(/anim\.gif is not a supported image type/i)).toBeTruthy();
  expect(uploadImageFn).not.toHaveBeenCalled();
});

test("duplicate uploaded image keys are deduplicated without React key errors", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { container } = render(
      <ProductEditor product={null} categories={[{ id: "tableware", name: "Tableware" }]} />,
      { wrapper: Providers },
    );

    await user.click(screen.getByRole("button", { name: "Add colour" }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    await user.upload(input, [first, second]);
    await waitFor(() => expect(uploadImageFn).toHaveBeenCalledTimes(2));

    expect(container.querySelectorAll("li img")).toHaveLength(1);
    const keyErrors = errSpy.mock.calls.filter((args) => String(args[0] ?? "").includes("same key"));
    expect(keyErrors).toHaveLength(0);
  } finally {
    errSpy.mockRestore();
  }
});

test("Sort order input can be cleared and accepts negative numbers", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<ProductEditor product={null} categories={[{ id: "tableware", name: "Tableware" }]} />, {
    wrapper: Providers,
  });

  const sortInput = screen.getByLabelText("Sort order") as HTMLInputElement;
  await user.clear(sortInput);
  expect(sortInput.value).toBe("");
  await user.type(sortInput, "-5");
  expect(sortInput.value).toBe("-5");
});

test("a successful save with a cache warning renders a warning alert instead of 'Not saved'", async () => {
  saveProductFn.mockReset().mockResolvedValue({
    ok: true,
    id: 1,
    revision: "rev-2",
    warning: "Saved, but the shop cache could not be refreshed.",
  });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<ProductEditor product={null} categories={[{ id: "tableware", name: "Tableware" }]} />, {
    wrapper: Providers,
  });

  await user.type(screen.getByLabelText("Name"), "Test Mug");
  await user.type(screen.getByLabelText(/^Price/i), "500");
  await user.click(screen.getAllByRole("button", { name: "Create product" })[0]!);

  expect(await screen.findByText(/shop cache could not be refreshed/i)).toBeTruthy();
  expect(screen.queryByText("Not saved")).toBeNull();
});

test("stopping stock counting on a 0-stock colour syncs ProductEditor availability instead of turning falsely dirty", () => {
  const baseProduct = {
    id: 1,
    slug: "mug",
    name: "Mug",
    categoryId: "tableware",
    summary: "Nice mug",
    details: [],
    note: null,
    price: 500,
    regularPrice: null,
    costPrice: 200,
    status: "published" as const,
    featured: false,
    sort: 0,
    revision: "rev-1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
    variants: [
      { id: 10, name: "Sage", swatch: "#9caf88", availability: "out_of_stock" as const, stock: 0, images: ["k1"] },
    ],
  };
  const { rerender } = render(
    <ProductEditor product={baseProduct} categories={[{ id: "tableware", name: "Tableware" }]} />,
    { wrapper: Providers },
  );
  expect(screen.queryByText("You have unsaved changes.")).toBeNull();

  // Stock counting is stopped: stock becomes null, availability stays out_of_stock, revision is unchanged.
  rerender(
    <ProductEditor
      product={{
        ...baseProduct,
        variants: [{ ...baseProduct.variants[0]!, stock: null }],
      }}
      categories={[{ id: "tableware", name: "Tableware" }]}
    />,
  );
  expect(screen.queryByText("You have unsaved changes.")).toBeNull();
});

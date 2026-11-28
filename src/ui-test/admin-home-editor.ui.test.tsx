import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_HOME_SETTINGS, type HomeSettings, homeSettingsSchema } from "@/domain/home-settings";

const optimizeImage = vi.hoisted(() => vi.fn());
const uploadImageFn = vi.hoisted(() => vi.fn());
const saveHomeSettingsFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/optimize-image", () => ({ optimizeImage }));
vi.mock("@/server/functions/admin-media.functions", () => ({ uploadImageFn }));
vi.mock("@/server/functions/admin-home.functions", () => ({ saveHomeSettingsFn }));
vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] }));

const { HomeEditor } = await import("@/components/admin/HomeEditor");

const KEY_1 = "products/home/11111111-1111-1111-1111-111111111111.webp";
const KEY_2 = "products/home/22222222-2222-2222-2222-222222222222.webp";

function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  optimizeImage.mockReset().mockImplementation(async (file: File) => ({
    file: new File(["webp"], `${file.name}.webp`, { type: "image/webp" }),
    width: 10,
    height: 10,
    originalBytes: file.size,
  }));
  uploadImageFn.mockReset();
  saveHomeSettingsFn.mockReset().mockImplementation(async ({ data }: { data: HomeSettings }) => ({
    ok: true,
    settings: data,
  }));
});
afterEach(cleanup);

test("caps philosophy images at 2, hides the upload button at the cap, and saves a schema-valid payload", async () => {
  uploadImageFn
    .mockResolvedValueOnce({ ok: true, key: KEY_1, bytes: 4, width: 10, height: 10 })
    .mockResolvedValueOnce({ ok: true, key: KEY_2, bytes: 4, width: 10, height: 10 });

  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<HomeEditor initial={DEFAULT_HOME_SETTINGS} imageBase="/media" />, {
    wrapper: Providers,
  });

  expect(screen.getByText("Philosophy images (0/2)")).toBeTruthy();

  const fileInput = () => container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(fileInput(), new File(["a"], "one.png", { type: "image/png" }));
  await waitFor(() => expect(screen.getByText("Philosophy images (1/2)")).toBeTruthy());
  expect(screen.getByRole("button", { name: /Upload philosophy image/i })).toBeTruthy();

  await user.upload(fileInput(), new File(["b"], "two.png", { type: "image/png" }));
  await waitFor(() => expect(screen.getByText("Philosophy images (2/2)")).toBeTruthy());
  expect(screen.queryByRole("button", { name: /Upload philosophy image/i })).toBeNull();

  await user.click(screen.getByRole("button", { name: /Save home page/i }));
  await waitFor(() => expect(saveHomeSettingsFn).toHaveBeenCalledTimes(1));

  const saved = saveHomeSettingsFn.mock.calls[0]![0].data as HomeSettings;
  expect(saved.philosophy.images).toEqual([KEY_1, KEY_2]);
  expect(homeSettingsSchema.safeParse(saved).success).toBe(true);
});

test("hides the philosophy upload button when 2 images already exist and restores it after removing one", async () => {
  const initial: HomeSettings = {
    ...DEFAULT_HOME_SETTINGS,
    philosophy: {
      ...DEFAULT_HOME_SETTINGS.philosophy,
      images: [KEY_1, KEY_2],
    },
  };

  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<HomeEditor initial={initial} imageBase="/media" />, { wrapper: Providers });

  expect(screen.getByText("Philosophy images (2/2)")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Upload philosophy image/i })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Remove philosophy image 2" }));
  expect(screen.getByText("Philosophy images (1/2)")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Upload philosophy image/i })).toBeTruthy();
});

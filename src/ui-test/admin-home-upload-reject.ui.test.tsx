import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_HOME_SETTINGS } from "@/domain/home-settings";
import { MAX_SOURCE_BYTES } from "@/domain/media";

const optimizeImage = vi.hoisted(() => vi.fn());
const uploadImageFn = vi.hoisted(() => vi.fn());
const saveHomeSettingsFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/optimize-image", () => ({ optimizeImage }));
vi.mock("@/server/functions/admin-media.functions", () => ({ uploadImageFn }));
vi.mock("@/server/functions/admin-home.functions", () => ({ saveHomeSettingsFn }));
vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] }));

const { HomeEditor } = await import("@/components/admin/HomeEditor");

function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  optimizeImage.mockReset();
  uploadImageFn.mockReset();
  saveHomeSettingsFn.mockReset();
});
afterEach(cleanup);

test("unsupported file types in HomeEditor ImageUploadButton show an error instead of failing silently", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });
  const { container } = render(<HomeEditor initial={DEFAULT_HOME_SETTINGS} imageBase="/media" />, {
    wrapper: Providers,
  });

  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const unsupported = new File(["plain text"], "notes.txt", { type: "text/plain" });
  await user.upload(input, unsupported);

  expect(await screen.findByText(/notes\.txt is not a supported image type/i)).toBeTruthy();
  expect(optimizeImage).not.toHaveBeenCalled();
  expect(uploadImageFn).not.toHaveBeenCalled();
});

test("oversized images in HomeEditor ImageUploadButton show a size limit error", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });
  const { container } = render(<HomeEditor initial={DEFAULT_HOME_SETTINGS} imageBase="/media" />, {
    wrapper: Providers,
  });

  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const oversized = new File(["x"], "huge.png", { type: "image/png" });
  Object.defineProperty(oversized, "size", { value: MAX_SOURCE_BYTES + 1 });
  await user.upload(input, oversized);

  expect(await screen.findByText(/Image must be under 30 MB/i)).toBeTruthy();
  expect(optimizeImage).not.toHaveBeenCalled();
  expect(uploadImageFn).not.toHaveBeenCalled();
});

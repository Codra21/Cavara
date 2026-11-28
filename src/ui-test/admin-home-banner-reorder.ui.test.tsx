import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_HOME_SETTINGS, type HomeSettings } from "@/domain/home-settings";

const optimizeImage = vi.hoisted(() => vi.fn());
const uploadImageFn = vi.hoisted(() => vi.fn());
const saveHomeSettingsFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/optimize-image", () => ({ optimizeImage }));
vi.mock("@/server/functions/admin-media.functions", () => ({ uploadImageFn }));
vi.mock("@/server/functions/admin-home.functions", () => ({ saveHomeSettingsFn }));
vi.mock("@/components/admin/queries", () => ({ ADMIN_QUERY_KEY: ["admin"] as const }));

const { HomeEditor } = await import("@/components/admin/HomeEditor");

function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeInitialSettings(): HomeSettings {
  return {
    ...DEFAULT_HOME_SETTINGS,
    banners: [
      {
        id: 1,
        desktopImage: "product-images/banner-a-old.webp",
        mobileImage: "",
        heading: "Banner A",
        buttonText: "Shop A",
        linkHref: "/products",
        active: true,
        sort: 0,
      },
      {
        id: 2,
        desktopImage: "product-images/banner-b-old.webp",
        mobileImage: "",
        heading: "Banner B",
        buttonText: "Shop B",
        linkHref: "/products",
        active: true,
        sort: 1,
      },
    ],
  };
}

beforeEach(() => {
  optimizeImage.mockReset().mockImplementation(async (file: File) => ({
    file: new File(["webp"], `${file.name}.webp`, { type: "image/webp" }),
    width: 10,
    height: 10,
    originalBytes: file.size,
  }));
  uploadImageFn.mockReset();
  saveHomeSettingsFn.mockReset();
});

afterEach(cleanup);

test("in-flight banner upload updates the original banner after moving it down", async () => {
  let resolveUpload!: (value: { ok: true; key: string; bytes: number; width: number; height: number }) => void;
  uploadImageFn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  saveHomeSettingsFn.mockImplementationOnce(async ({ data }: { data: HomeSettings }) => ({
    ok: true,
    settings: data,
  }));

  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<HomeEditor initial={makeInitialSettings()} imageBase="/media" />, {
    wrapper: Providers,
  });

  const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const bannerADesktopFileInput = fileInputs[0]!;
  await user.upload(bannerADesktopFileInput, new File(["img"], "banner-a.png", { type: "image/png" }));
  await waitFor(() => expect(uploadImageFn).toHaveBeenCalledTimes(1));

  // Move Banner A (currently first) down so it swaps with Banner B while the upload is still in flight.
  await user.click(screen.getByRole("button", { name: "Move banner 1 down" }));

  const headingInputs = screen.getAllByLabelText("Heading (optional)") as HTMLInputElement[];
  expect(headingInputs.map((el) => el.value)).toEqual(["Banner B", "Banner A"]);

  await act(async () => {
    resolveUpload({ ok: true, key: "product-images/banner-a-new.webp", bytes: 4, width: 10, height: 10 });
  });

  await waitFor(() => {
    const desktopInputs = screen.getAllByLabelText("Desktop image key / URL") as HTMLInputElement[];
    expect(desktopInputs[1]!.value).toBe("product-images/banner-a-new.webp");
  });

  const desktopInputs = screen.getAllByLabelText("Desktop image key / URL") as HTMLInputElement[];
  expect(desktopInputs[0]!.value).toBe("product-images/banner-b-old.webp");
  expect(desktopInputs[1]!.value).toBe("product-images/banner-a-new.webp");

  await user.click(screen.getByRole("button", { name: /Save home page/i }));
  await waitFor(() => expect(saveHomeSettingsFn).toHaveBeenCalledTimes(1));
  const saved = saveHomeSettingsFn.mock.calls[0]![0].data as HomeSettings;
  expect(saved.banners.map((b) => b.desktopImage)).toEqual([
    "product-images/banner-b-old.webp",
    "product-images/banner-a-new.webp",
  ]);
  for (const banner of saved.banners) {
    expect("uid" in banner).toBe(false);
  }
});

test("in-flight banner upload does not overwrite another banner after its banner is removed", async () => {
  let resolveUpload!: (value: { ok: true; key: string; bytes: number; width: number; height: number }) => void;
  uploadImageFn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );

  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<HomeEditor initial={makeInitialSettings()} imageBase="/media" />, {
    wrapper: Providers,
  });

  const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const bannerADesktopFileInput = fileInputs[0]!;
  await user.upload(bannerADesktopFileInput, new File(["img"], "banner-a.png", { type: "image/png" }));
  await waitFor(() => expect(uploadImageFn).toHaveBeenCalledTimes(1));

  // Remove Banner A while its upload is still in flight; Banner B shifts into index 0.
  await user.click(screen.getByRole("button", { name: "Remove banner 1" }));
  const headingInputs = screen.getAllByLabelText("Heading (optional)") as HTMLInputElement[];
  expect(headingInputs.map((el) => el.value)).toEqual(["Banner B"]);

  await act(async () => {
    resolveUpload({ ok: true, key: "product-images/banner-a-deleted.webp", bytes: 4, width: 10, height: 10 });
  });

  const desktopInputs = screen.getAllByLabelText("Desktop image key / URL") as HTMLInputElement[];
  expect(desktopInputs).toHaveLength(1);
  expect(desktopInputs[0]!.value).toBe("product-images/banner-b-old.webp");
});

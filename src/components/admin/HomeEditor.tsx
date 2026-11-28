import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ImagePlus,
  LayoutTemplate,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import {
  HOME_SECTION_LABELS,
  type HomeBanner,
  type HomeSettings,
  homeSettingsSchema,
  MAX_HOME_BANNERS,
} from "@/domain/home-settings";
import { MAX_SOURCE_BYTES, mediaUrl, UPLOAD_ACCEPT } from "@/domain/media";
import { optimizeImage } from "@/lib/optimize-image";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileInput, FileInputTrigger } from "@ui-sdk/react/file-input";
import { saveHomeSettingsFn } from "@/server/functions/admin-home.functions";
import { uploadImageFn } from "@/server/functions/admin-media.functions";
import { ADMIN_QUERY_KEY } from "./queries";

const NO_FILES: File[] = [];
const MAX_PHILOSOPHY_IMAGES = 2;

type EditableBanner = HomeBanner & { uid: string };
type EditableHomeSettings = Omit<HomeSettings, "banners"> & { banners: EditableBanner[] };

let nextBannerUid = 0;

function createBannerUid(): string {
  nextBannerUid += 1;
  return `banner-${nextBannerUid}`;
}

function withBannerUids(settings: HomeSettings): EditableHomeSettings {
  return {
    ...settings,
    banners: settings.banners.map((banner) => ({ ...banner, uid: createBannerUid() })),
  };
}

function stripBannerUids(settings: EditableHomeSettings): HomeSettings {
  return {
    ...settings,
    banners: settings.banners.map(({ uid: _uid, ...banner }) => banner),
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function ImageUploadButton({ label, onUploaded }: { label: string; onUploaded: (key: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_SOURCE_BYTES) {
      setError(`Image must be under ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const optimized = await optimizeImage(file);
      const form = new FormData();
      form.set("file", optimized.file);
      form.set("productId", "home");
      const result = await uploadImageFn({ data: form });
      if (result.ok) onUploaded(result.key);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <FileInput accept={UPLOAD_ACCEPT} value={NO_FILES} onValueChange={upload} disabled={busy}>
        <FileInputTrigger render={<Button type="button" variant="outline" size="sm" />}>
          <ImagePlus /> {busy ? "Uploading…" : label}
        </FileInputTrigger>
      </FileInput>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Owner-only Home Editor (/admin/home): rotating banners (1-5), section visibility/order/headings, and philosophy. */
export function HomeEditor({ initial, imageBase }: { initial: HomeSettings; imageBase: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<EditableHomeSettings>(() => withBannerUids(initial));
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; warning: boolean } | null>(null);

  const save = useMutation({
    mutationFn: (input: HomeSettings) => saveHomeSettingsFn({ data: input }),
    onSuccess: async (result) => {
      setProblems([]);
      setSettings(withBannerUids(result.settings));
      setNotice({
        text: result.warning ?? "Home page settings saved.",
        warning: Boolean(result.warning),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "home"] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] }),
      ]);
    },
    onError: (err) => setProblems([err.message || "Could not save home settings."]),
  });

  const updateBanner = (uid: string, patch: Partial<HomeBanner>) => {
    setNotice(null);
    setSettings((prev) => {
      if (!prev.banners.some((b) => b.uid === uid)) return prev;
      return {
        ...prev,
        banners: prev.banners.map((b) => (b.uid === uid ? { ...b, ...patch } : b)),
      };
    });
  };

  const moveBanner = (uid: string, delta: -1 | 1) => {
    setNotice(null);
    setSettings((prev) => {
      const from = prev.banners.findIndex((b) => b.uid === uid);
      if (from === -1) return prev;
      return { ...prev, banners: move(prev.banners, from, from + delta) };
    });
  };

  const removeBanner = (uid: string) => {
    setNotice(null);
    setSettings((prev) => ({
      ...prev,
      banners: prev.banners.filter((b) => b.uid !== uid),
    }));
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const parsed = homeSettingsSchema.safeParse(stripBannerUids(settings));
    if (!parsed.success) {
      setProblems([...new Set(parsed.error.issues.map((i) => i.message))]);
      return;
    }
    setProblems([]);
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Home page</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage rotating banners (1 to 5), reorder or hide sections, edit headings, and update Our philosophy.
          </p>
        </div>
        <Button type="submit" disabled={save.isPending}>
          <Save /> {save.isPending ? "Saving…" : "Save home page"}
        </Button>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {problems.length ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant={notice.warning ? "warning" : "success"} role="status">
            <CheckCircle2 />
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <LayoutTemplate aria-hidden="true" className="size-4 text-primary" />
              <CardTitle>
                Banners ({settings.banners.length}/{MAX_HOME_BANNERS})
              </CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={settings.banners.length >= MAX_HOME_BANNERS}
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  banners: [
                    ...prev.banners,
                    {
                      uid: createBannerUid(),
                      id: null,
                      desktopImage: "",
                      mobileImage: "",
                      heading: "",
                      buttonText: "Shop now",
                      linkHref: "/products",
                      active: true,
                      sort: prev.banners.length,
                    },
                  ],
                }))
              }
            >
              <Plus /> Add banner
            </Button>
          </div>
          <CardDescription>
            One active banner renders as a still image; 2 to 5 active banners rotate automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          {settings.banners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom banners yet — the storefront shows the default product hero until you add one.
            </p>
          ) : null}
          {settings.banners.map((banner, index) => (
            <div key={banner.uid} className="grid gap-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-banner-active-${banner.uid}`}
                    checked={banner.active}
                    onCheckedChange={(checked) => updateBanner(banner.uid, { active: checked === true })}
                  />
                  <Label htmlFor={`${id}-banner-active-${banner.uid}`}>Banner {index + 1} active</Label>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    aria-label={`Move banner ${index + 1} up`}
                    onClick={() => moveBanner(banner.uid, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === settings.banners.length - 1}
                    aria-label={`Move banner ${index + 1} down`}
                    onClick={() => moveBanner(banner.uid, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove banner ${index + 1}`}
                    onClick={() => removeBanner(banner.uid)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-desktop-${banner.uid}`}>Desktop image key / URL</Label>
                  <Input
                    id={`${id}-desktop-${banner.uid}`}
                    value={banner.desktopImage}
                    onChange={(e) => updateBanner(banner.uid, { desktopImage: e.target.value })}
                    placeholder="product-images/..."
                  />
                  <ImageUploadButton
                    label="Upload desktop image"
                    onUploaded={(key) => updateBanner(banner.uid, { desktopImage: key })}
                  />
                  {banner.desktopImage ? (
                    <img
                      src={
                        banner.desktopImage.startsWith("/") || /^https?:\/\//.test(banner.desktopImage)
                          ? banner.desktopImage
                          : mediaUrl(imageBase, banner.desktopImage)
                      }
                      alt=""
                      className="h-20 w-40 rounded border border-border object-cover"
                    />
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-mobile-${banner.uid}`}>Mobile image key / URL (optional)</Label>
                  <Input
                    id={`${id}-mobile-${banner.uid}`}
                    value={banner.mobileImage}
                    onChange={(e) => updateBanner(banner.uid, { mobileImage: e.target.value })}
                    placeholder="Defaults to desktop image"
                  />
                  <ImageUploadButton
                    label="Upload mobile image"
                    onUploaded={(key) => updateBanner(banner.uid, { mobileImage: key })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-heading-${banner.uid}`}>Heading (optional)</Label>
                  <Input
                    id={`${id}-heading-${banner.uid}`}
                    value={banner.heading}
                    maxLength={160}
                    onChange={(e) => updateBanner(banner.uid, { heading: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-btn-${banner.uid}`}>Button text (optional)</Label>
                  <Input
                    id={`${id}-btn-${banner.uid}`}
                    value={banner.buttonText}
                    maxLength={60}
                    onChange={(e) => updateBanner(banner.uid, { buttonText: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2 grid gap-1.5">
                  <Label htmlFor={`${id}-link-${banner.uid}`}>Link (product, category, page, or URL)</Label>
                  <Input
                    id={`${id}-link-${banner.uid}`}
                    value={banner.linkHref}
                    maxLength={300}
                    placeholder="/products, /collections/drinkware, /products/slug, or https://..."
                    onChange={(e) => updateBanner(banner.uid, { linkHref: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>Sections order &amp; headings</CardTitle>
          <CardDescription>Show, hide, reorder, and rename home page sections.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4">
          {settings.sections.map((section, index) => (
            <div
              key={section.key}
              className="grid items-center gap-3 rounded-md border border-border p-3 sm:grid-cols-[auto_10rem_minmax(0,1fr)_auto]"
            >
              <Checkbox
                id={`${id}-sec-${section.key}`}
                checked={section.visible}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    sections: prev.sections.map((s, i) => (i === index ? { ...s, visible: checked === true } : s)),
                  }))
                }
              />
              <Label htmlFor={`${id}-sec-${section.key}`} className="font-medium">
                {HOME_SECTION_LABELS[section.key]}
              </Label>
              <Input
                value={section.heading}
                maxLength={120}
                placeholder="Section heading"
                aria-label={`Heading for ${HOME_SECTION_LABELS[section.key]}`}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    sections: prev.sections.map((s, i) => (i === index ? { ...s, heading: e.target.value } : s)),
                  }))
                }
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label={`Move ${HOME_SECTION_LABELS[section.key]} up`}
                  onClick={() => setSettings((prev) => ({ ...prev, sections: move(prev.sections, index, index - 1) }))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === settings.sections.length - 1}
                  aria-label={`Move ${HOME_SECTION_LABELS[section.key]} down`}
                  onClick={() => setSettings((prev) => ({ ...prev, sections: move(prev.sections, index, index + 1) }))}
                >
                  <ArrowDown />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>Our philosophy</CardTitle>
          <CardDescription>Text and images shown in the Our philosophy section.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-phil-eyebrow`}>Eyebrow</Label>
              <Input
                id={`${id}-phil-eyebrow`}
                value={settings.philosophy.eyebrow}
                maxLength={80}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, philosophy: { ...prev.philosophy, eyebrow: e.target.value } }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-phil-heading`}>Heading</Label>
              <Input
                id={`${id}-phil-heading`}
                value={settings.philosophy.heading}
                maxLength={160}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, philosophy: { ...prev.philosophy, heading: e.target.value } }))
                }
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-phil-body`}>Text</Label>
            <Textarea
              id={`${id}-phil-body`}
              rows={4}
              maxLength={1200}
              value={settings.philosophy.body}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, philosophy: { ...prev.philosophy, body: e.target.value } }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>
              Philosophy images ({settings.philosophy.images.length}/{MAX_PHILOSOPHY_IMAGES})
            </Label>
            <div className="flex flex-wrap gap-2">
              {settings.philosophy.images.map((key, idx) => (
                <div
                  key={`${key}-${idx}`}
                  className="flex items-center gap-2 rounded border border-border p-1.5 text-xs"
                >
                  <span className="max-w-[12rem] truncate">{key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove philosophy image ${idx + 1}`}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        philosophy: {
                          ...prev.philosophy,
                          images: prev.philosophy.images.filter((_, i) => i !== idx),
                        },
                      }))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            {settings.philosophy.images.length < MAX_PHILOSOPHY_IMAGES ? (
              <ImageUploadButton
                label="Upload philosophy image"
                onUploaded={(key) =>
                  setSettings((prev) => ({
                    ...prev,
                    philosophy: {
                      ...prev.philosophy,
                      images: [...prev.philosophy.images, key].slice(0, MAX_PHILOSOPHY_IMAGES),
                    },
                  }))
                }
              />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

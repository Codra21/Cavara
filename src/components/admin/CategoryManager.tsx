import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FolderTree, Plus, Save } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  type CategoryInput,
  categoryInputSchema,
  type ManagedCategory,
} from "@/domain/categories-admin";
import { slugify } from "@/domain/product-admin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveCategoryFn } from "@/server/functions/admin-categories.functions";
import { ADMIN_QUERY_KEY } from "./queries";

interface FormState {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  image: string;
  parentId: string;
  sort: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  slug: "",
  description: "",
  image: "",
  parentId: "__none__",
  sort: "0",
  active: true,
};

function toForm(category: ManagedCategory): FormState {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    parentId: category.parentId ?? "__none__",
    sort: String(category.sort),
    active: category.active,
  };
}

/** Owner-only Category & Subcategory manager with stable internal ids, changeable slugs (301), and WebMCP agent tools. */
export function CategoryManager({ categories }: { categories: ManagedCategory[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; warning: boolean } | null>(null);

  const topLevel = useMemo(() => categories.filter((cat) => !cat.parentId), [categories]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ManagedCategory[]>();
    for (const cat of categories) {
      if (!cat.parentId) continue;
      const list = map.get(cat.parentId) ?? [];
      list.push(cat);
      map.set(cat.parentId, list);
    }
    return map;
  }, [categories]);

  const save = useMutation({
    mutationFn: (input: CategoryInput) => saveCategoryFn({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setProblems([result.error]);
        return;
      }
      setProblems([]);
      setNotice({
        text: result.warning ?? `Saved "${result.category.name}" (/${result.category.slug}).`,
        warning: Boolean(result.warning),
      });
      setForm(toForm(result.category));
      setSlugTouched(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "categories"] }),
        queryClient.invalidateQueries({ queryKey: [...ADMIN_QUERY_KEY, "audit"] }),
      ]);
    },
    onError: (error) => setProblems([error.message || "Could not save category. Try again."]),
  });

  // WebMCP / browser agent tool registration (C2.7 / 4b) when navigator.modelContext is available.
  useEffect(() => {
    const mc = (
      navigator as Navigator & {
        modelContext?: {
          registerTool?: (tool: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
            execute: (args: Record<string, unknown>) => Promise<unknown>;
          }) => { unregister?: () => void } | void;
        };
      }
    ).modelContext;
    if (!mc?.registerTool) return;
    const handles: ({ unregister?: () => void } | void)[] = [];
    handles.push(
      mc.registerTool({
        name: "cavara_list_categories",
        description: "List all Cavara categories and subcategories with their stable ids, URL slugs, parentId, and product counts.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ categories }),
      }),
    );
    handles.push(
      mc.registerTool({
        name: "cavara_save_category",
        description:
          "Create or update a category or subcategory. Changing slug on an existing category automatically registers a 301 redirect from the old slug.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: ["string", "null"], description: "Existing stable id, or null to create." },
            name: { type: "string" },
            slug: { type: "string" },
            description: { type: "string" },
            parentId: { type: ["string", "null"] },
            sort: { type: "integer" },
            active: { type: "boolean" },
          },
          required: ["name", "slug"],
        },
        execute: async (args) => {
          const parsed = categoryInputSchema.safeParse({
            id: args.id ?? null,
            name: args.name,
            slug: args.slug,
            description: args.description ?? "",
            image: args.image ?? "",
            parentId: args.parentId ?? null,
            sort: typeof args.sort === "number" ? args.sort : 0,
            active: typeof args.active === "boolean" ? args.active : true,
          });
          if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
          return saveCategoryFn({ data: parsed.data });
        },
      }),
    );
    return () => {
      for (const h of handles) h?.unregister?.();
    };
  }, [categories]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const parsed = categoryInputSchema.safeParse({
      id: form.id,
      name: form.name,
      slug: form.slug,
      description: form.description,
      image: form.image,
      parentId: form.parentId === "__none__" ? null : form.parentId,
      sort: Number.parseInt(form.sort, 10) || 0,
      active: form.active,
    });
    if (!parsed.success) {
      setProblems([...new Set(parsed.error.issues.map((i) => i.message))]);
      return;
    }
    setProblems([]);
    save.mutate(parsed.data);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Two-level categories (category › subcategory). Internal IDs stay fixed; changing a URL name automatically
            redirects the old link (301).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setForm(EMPTY_FORM);
            setSlugTouched(false);
            setProblems([]);
            setNotice(null);
          }}
        >
          <Plus /> New category
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <FolderTree aria-hidden="true" className="size-4 text-primary" />
              <CardTitle>All categories ({categories.length})</CardTitle>
            </div>
            <CardDescription>Click a row to edit its name, URL slug, parent, or visibility.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="grid gap-2">
              {topLevel.map((cat) => (
                <li key={cat.id} className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(toForm(cat));
                      setSlugTouched(true);
                      setProblems([]);
                      setNotice(null);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50 ${
                      form.id === cat.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <span>{cat.name}</span>
                        {!cat.active ? <Badge variant="outline">Hidden</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        id: <code>{cat.id}</code> · /collections/{cat.slug}
                        {cat.oldSlugs.length ? ` · redirects: ${cat.oldSlugs.join(", ")}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{cat.productCount} products</Badge>
                  </button>
                  {(childrenByParent.get(cat.id) ?? []).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => {
                        setForm(toForm(sub));
                        setSlugTouched(true);
                        setProblems([]);
                        setNotice(null);
                      }}
                      className={`ml-6 flex items-center justify-between gap-3 rounded-md border p-2.5 text-left transition-colors hover:bg-muted/50 ${
                        form.id === sub.id ? "border-primary bg-primary/5" : "border-border/80"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span>↳ {sub.name}</span>
                          {!sub.active ? <Badge variant="outline">Hidden</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          id: <code>{sub.id}</code> · /collections/{cat.slug}/{sub.slug}
                        </p>
                      </div>
                      <Badge variant="secondary">{sub.productCount}</Badge>
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle>{form.id ? `Edit "${form.name || form.id}"` : "New category"}</CardTitle>
            <CardDescription>
              {form.id ? `Stable ID: ${form.id}` : "Leave parent as Top-level or pick a parent to make a subcategory."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={submit} noValidate className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input
                  id={`${id}-name`}
                  value={form.name}
                  maxLength={80}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((prev) => ({ ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-slug`}>URL name (slug)</Label>
                <Input
                  id={`${id}-slug`}
                  value={form.slug}
                  maxLength={64}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase() }));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-parent`}>Parent category</Label>
                <Select value={form.parentId} onValueChange={(value) => setForm((prev) => ({ ...prev, parentId: value }))}>
                  <SelectTrigger id={`${id}-parent`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Top-level category</SelectItem>
                    {topLevel
                      .filter((cat) => cat.id !== form.id)
                      .map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-desc`}>Description</Label>
                <Textarea
                  id={`${id}-desc`}
                  rows={2}
                  maxLength={300}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-sort`}>Sort order</Label>
                <Input
                  id={`${id}-sort`}
                  type="number"
                  inputMode="numeric"
                  value={form.sort}
                  onChange={(e) => setForm((prev) => ({ ...prev, sort: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-active`}
                  checked={form.active}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, active: checked === true }))}
                />
                <Label htmlFor={`${id}-active`}>Active (shown on shop)</Label>
              </div>
              <Button type="submit" disabled={save.isPending}>
                <Save /> {save.isPending ? "Saving…" : form.id ? "Save category" : "Create category"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

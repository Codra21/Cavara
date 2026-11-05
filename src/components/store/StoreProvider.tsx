import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { productById } from "~/lib/catalog";
import { MAX_QTY, PALETTES, RECENT_LIMIT, STORAGE_KEYS } from "~/lib/config";
import { storageGet, storageSet } from "~/lib/dom";
import type { BagItem } from "~/lib/types";

export interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
  inBag?: boolean;
}

interface StoreValue {
  bag: BagItem[];
  bagCount: number;
  bagBump: number;
  addToBag: (productId: number, variant: number, qty?: number) => void;
  updateBagItem: (productId: number, variant: number, qty: number) => void;
  clearBag: () => void;

  selectedVariants: Record<number, number>;
  selectedVariant: (productId: number) => number;
  selectVariant: (productId: number, variant: number) => void;

  palette: string;
  setPalette: (id: string) => void;

  toast: ToastState | null;
  showToast: (message: string, options?: Omit<ToastState, "id" | "message">) => void;
  hideToast: () => void;

  quickView: number | null;
  openQuickView: (productId: number, variant?: number) => void;
  closeQuickView: () => void;

  bagOpen: boolean;
  openBag: () => void;
  closeBag: () => void;

  recent: number[];
  rememberViewed: (productId: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function clampQty(value: number) {
  return Math.min(MAX_QTY, Math.max(1, value));
}

function loadBag(): BagItem[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(STORAGE_KEYS.bag) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: { id?: unknown; variant?: unknown; qty?: unknown }) => ({
        id: Number(item.id),
        variant: Number(item.variant),
        qty: clampQty(Number(item.qty) || 1),
      }))
      .filter((item) => productById.get(item.id)?.variants[item.variant]);
  } catch {
    return [];
  }
}

function loadRecent(): number[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(STORAGE_KEYS.recent) || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => productById.has(id)).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function applyPaletteToDocument(id: string) {
  const palette = PALETTES.find((item) => item.id === id) ?? PALETTES[0];
  document.documentElement.dataset.palette = palette.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.theme);
  return palette.id;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Browser-only state starts empty so server and first client render match; it loads after hydration.
  const [bag, setBag] = useState<BagItem[]>([]);
  const [bagBump, setBagBump] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});
  const [palette, setPaletteState] = useState(PALETTES[0].id);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [quickView, setQuickView] = useState<number | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setBag(loadBag());
    setRecent(loadRecent());
    setPaletteState(applyPaletteToDocument(document.documentElement.dataset.palette || storageGet(STORAGE_KEYS.palette) || "teal"));
    setHydrated(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.bag) setBag(loadBag());
      if (event.key === STORAGE_KEYS.palette && event.newValue) setPaletteState(applyPaletteToDocument(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    // Only persist after the saved bag has been loaded, or the empty initial state would overwrite it.
    if (hydrated) storageSet(STORAGE_KEYS.bag, JSON.stringify(bag));
  }, [bag, hydrated]);

  const addToBag = useCallback((productId: number, variant: number, qty = 1) => {
    setBag((current) => {
      const existing = current.find((item) => item.id === productId && item.variant === variant);
      if (existing) return current.map((item) => (item === existing ? { ...item, qty: clampQty(item.qty + qty) } : item));
      return [...current, { id: productId, variant, qty: clampQty(qty) }];
    });
    setBagBump((value) => value + 1);
  }, []);

  const updateBagItem = useCallback((productId: number, variant: number, qty: number) => {
    setBag((current) =>
      qty <= 0
        ? current.filter((item) => !(item.id === productId && item.variant === variant))
        : current.map((item) => (item.id === productId && item.variant === variant ? { ...item, qty: clampQty(qty) } : item))
    );
  }, []);

  const clearBag = useCallback(() => setBag([]), []);

  const selectedVariant = useCallback((productId: number) => selectedVariants[productId] ?? 0, [selectedVariants]);
  const selectVariant = useCallback((productId: number, variant: number) => {
    if (!productById.get(productId)?.variants[variant]) return;
    setSelectedVariants((current) => ({ ...current, [productId]: variant }));
  }, []);

  const setPalette = useCallback((id: string) => {
    const applied = applyPaletteToDocument(id);
    setPaletteState(applied);
    storageSet(STORAGE_KEYS.palette, applied);
  }, []);

  const hideToast = useCallback(() => setToast(null), []);
  const showToast = useCallback((message: string, options: Omit<ToastState, "id" | "message"> = {}) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, ...options });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const openQuickView = useCallback(
    (productId: number, variant?: number) => {
      if (variant !== undefined) selectVariant(productId, variant);
      setBagOpen(false);
      setToast(null);
      setQuickView(productId);
    },
    [selectVariant]
  );
  const closeQuickView = useCallback(() => setQuickView(null), []);

  const openBag = useCallback(() => {
    setQuickView(null);
    setToast(null);
    setBagOpen(true);
  }, []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  const rememberViewed = useCallback((productId: number) => {
    setRecent((current) => {
      const next = [productId, ...current.filter((id) => id !== productId)].slice(0, RECENT_LIMIT);
      storageSet(STORAGE_KEYS.recent, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      bag,
      bagCount: bag.reduce((sum, item) => sum + item.qty, 0),
      bagBump,
      addToBag,
      updateBagItem,
      clearBag,
      selectedVariants,
      selectedVariant,
      selectVariant,
      palette,
      setPalette,
      toast,
      showToast,
      hideToast,
      quickView,
      openQuickView,
      closeQuickView,
      bagOpen,
      openBag,
      closeBag,
      recent,
      rememberViewed,
    }),
    [bag, bagBump, addToBag, updateBagItem, clearBag, selectedVariants, selectedVariant, selectVariant, palette, setPalette, toast, showToast, hideToast, quickView, openQuickView, closeQuickView, bagOpen, openBag, closeBag, recent, rememberViewed]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

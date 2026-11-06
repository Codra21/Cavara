import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAX_QTY, RECENT_LIMIT, STORAGE_KEYS } from "@/lib/config";
import { storageGet, storageSet } from "@/lib/dom";
import { useCatalog } from "@/lib/query";
import type { CatalogIndex } from "@/domain/catalog";
import type { BagItem } from "@/lib/types";
import { applyTheme, isTheme, onSystemThemeChange, saveTheme, storedTheme, systemTheme, type Theme } from "@/lib/theme";

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

  theme: Theme;
  toggleTheme: () => void;

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

function loadBag(catalog: CatalogIndex): BagItem[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(STORAGE_KEYS.bag) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: { id?: unknown; variant?: unknown; qty?: unknown }) => ({
        id: Number(item.id),
        variant: Number(item.variant),
        qty: clampQty(Number(item.qty) || 1),
      }))
      .filter((item) => catalog.productById.get(item.id)?.variants[item.variant]);
  } catch {
    return [];
  }
}

function loadRecent(catalog: CatalogIndex): number[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(STORAGE_KEYS.recent) || "[]");
    return Array.isArray(parsed)
      ? parsed
          .map(Number)
          .filter((id) => catalog.productById.has(id))
          .slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const catalog = useCatalog();
  // Storage listeners outlive renders; read the latest catalogue through a ref.
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  // Browser-only state starts empty so server and first client render match; it loads after hydration.
  const [bag, setBag] = useState<BagItem[]>([]);
  const [bagBump, setBagBump] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});
  const [theme, setTheme] = useState<Theme>("light");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [quickView, setQuickView] = useState<number | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setBag(loadBag(catalogRef.current));
    setRecent(loadRecent(catalogRef.current));
    // THEME_BOOT already applied the theme; read it back. Follow the system until the visitor chooses.
    const booted = document.documentElement.dataset.theme;
    setTheme(isTheme(booted) ? booted : systemTheme());
    const stopFollowingSystem = onSystemThemeChange((next) => {
      if (storedTheme()) return;
      applyTheme(next);
      setTheme(next);
    });
    setHydrated(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.bag) setBag(loadBag(catalogRef.current));
      if (event.key === STORAGE_KEYS.theme) {
        const next = isTheme(event.newValue) ? event.newValue : systemTheme();
        applyTheme(next);
        setTheme(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      stopFollowingSystem();
    };
  }, []);

  useEffect(() => {
    // Only persist after the saved bag has been loaded, or the empty initial state would overwrite it.
    if (hydrated) storageSet(STORAGE_KEYS.bag, JSON.stringify(bag));
  }, [bag, hydrated]);

  const addToBag = useCallback((productId: number, variant: number, qty = 1) => {
    setBag((current) => {
      const existing = current.find((item) => item.id === productId && item.variant === variant);
      if (existing)
        return current.map((item) => (item === existing ? { ...item, qty: clampQty(item.qty + qty) } : item));
      return [...current, { id: productId, variant, qty: clampQty(qty) }];
    });
    setBagBump((value) => value + 1);
  }, []);

  const updateBagItem = useCallback((productId: number, variant: number, qty: number) => {
    setBag((current) =>
      qty <= 0
        ? current.filter((item) => !(item.id === productId && item.variant === variant))
        : current.map((item) =>
            item.id === productId && item.variant === variant ? { ...item, qty: clampQty(qty) } : item,
          ),
    );
  }, []);

  const clearBag = useCallback(() => setBag([]), []);

  const selectedVariant = useCallback((productId: number) => selectedVariants[productId] ?? 0, [selectedVariants]);
  const selectVariant = useCallback((productId: number, variant: number) => {
    if (!catalogRef.current.productById.get(productId)?.variants[variant]) return;
    setSelectedVariants((current) => ({ ...current, [productId]: variant }));
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }, [theme]);

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
    [selectVariant],
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
      theme,
      toggleTheme,
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
    [
      bag,
      bagBump,
      addToBag,
      updateBagItem,
      clearBag,
      selectedVariants,
      selectedVariant,
      selectVariant,
      theme,
      toggleTheme,
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
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

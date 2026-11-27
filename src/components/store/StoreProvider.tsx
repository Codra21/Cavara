import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RECENT_LIMIT, STORAGE_KEYS } from "@/lib/config";
import { storageGet, storageSet } from "@/lib/dom";
import { addBagLine, clampQty, normalizeBag } from "@/domain/bag";
import type { BagItem } from "@/lib/types";
import { applyTheme, isTheme, onSystemThemeChange, saveTheme, storedTheme, systemTheme, type Theme } from "@/lib/theme";

interface ToastState {
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
  /** False when the bag already holds the most lines an order can have and this colour is not one of them. */
  addToBag: (productId: number, variant: number, qty?: number, maxQty?: number) => { added: boolean; addedQty: number };
  updateBagItem: (productId: number, variant: number, qty: number, maxQty?: number) => void;
  clearBag: () => void;

  selectedVariant: (productId: number) => number;
  pickedVariant: (productId: number) => number | undefined;
  selectVariant: (productId: number, variant: number) => void;

  theme: Theme;
  toggleTheme: () => void;

  toast: ToastState | null;
  showToast: (message: string, options?: Omit<ToastState, "id" | "message">) => void;
  hideToast: () => void;

  bagOpen: boolean;
  openBag: () => void;
  closeBag: () => void;

  recent: number[];
  rememberViewed: (productId: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

// The bag and the recent list are checked for shape only. Whether a product still exists is the server's answer
// (getProductsByIdsFn), shown by the bag drawer as "unavailable" instead of silently dropping the line.
function loadBag(): BagItem[] {
  try {
    return normalizeBag(JSON.parse(storageGet(STORAGE_KEYS.bag) || "[]"));
  } catch {
    return [];
  }
}

function loadRecent(): number[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(STORAGE_KEYS.recent) || "[]");
    if (!Array.isArray(parsed)) return [];
    const ids = (parsed as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0);
    return [...new Set(ids)].slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Browser-only state starts empty so server and first client render match; it loads after hydration.
  const [bag, setBagState] = useState<BagItem[]>([]);
  // The latest bag, readable synchronously, so addToBag can answer "was it added?" before React re-renders.
  const bagRef = useRef<BagItem[]>([]);
  const setBag = useCallback((next: BagItem[]) => {
    bagRef.current = next;
    setBagState(next);
  }, []);
  const [bagBump, setBagBump] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});
  const [theme, setTheme] = useState<Theme>("light");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setBag(loadBag());
    setRecent(loadRecent());
    // THEME_BOOT already applied the theme; read it back. Follow the system until the visitor chooses.
    const booted = document.documentElement.dataset.theme;
    setTheme(isTheme(booted) ? booted : systemTheme());
    const stopFollowingSystem = onSystemThemeChange((next) => {
      if (storedTheme()) return;
      applyTheme(next);
      setTheme(next);
    });
    hydratedRef.current = true;
    setHydrated(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.bag) setBag(loadBag());
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

  const addToBag = useCallback(
    (productId: number, variant: number, qty = 1, maxQty?: number) => {
      // An order holds at most MAX_BAG_LINES lines, so a longer bag could never be placed (see addBagLine).
      const before = bagRef.current.find((item) => item.id === productId && item.variant === variant)?.qty ?? 0;
      const result = addBagLine(bagRef.current, productId, variant, qty, maxQty);
      if (!result.added) return { added: false, addedQty: 0 };
      const after = result.bag.find((item) => item.id === productId && item.variant === variant)?.qty ?? 0;
      const addedQty = Math.max(0, after - before);
      if (addedQty > 0) {
        setBag(result.bag);
        setBagBump((value) => value + 1);
      }
      return { added: true, addedQty };
    },
    [setBag],
  );

  const updateBagItem = useCallback(
    (productId: number, variant: number, qty: number, maxQty?: number) => {
      const current = bagRef.current;
      setBag(
        qty <= 0
          ? current.filter((item) => !(item.id === productId && item.variant === variant))
          : current.map((item) =>
              item.id === productId && item.variant === variant ? { ...item, qty: clampQty(qty, maxQty) } : item,
            ),
      );
    },
    [setBag],
  );

  const clearBag = useCallback(() => setBag([]), [setBag]);

  const pickedVariant = useCallback((productId: number) => selectedVariants[productId], [selectedVariants]);
  const selectedVariant = useCallback((productId: number) => selectedVariants[productId] ?? 0, [selectedVariants]);
  const selectVariant = useCallback((productId: number, variant: number) => {
    if (!Number.isInteger(variant) || variant < 0) return;
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

  const openBag = useCallback(() => {
    setToast(null);
    setBagOpen(true);
  }, []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  const rememberViewed = useCallback((productId: number) => {
    setRecent((current) => {
      // Child effects (ProductPage) run before StoreProvider's hydration effect; read storage first so we don't wipe it.
      const base = hydratedRef.current ? current : loadRecent();
      const next = [productId, ...base.filter((id) => id !== productId)].slice(0, RECENT_LIMIT);
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
      selectedVariant,
      pickedVariant,
      selectVariant,
      theme,
      toggleTheme,
      toast,
      showToast,
      hideToast,
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
      pickedVariant,
      selectVariant,
      theme,
      toggleTheme,
      toast,
      showToast,
      hideToast,
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

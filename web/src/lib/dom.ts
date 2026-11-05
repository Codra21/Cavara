export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private modes; the session still works.
  }
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function finePointer() {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Scrolls to the shop section and optionally focuses the search field. */
export function scrollToShop({ focusSearch = false } = {}) {
  const shop = document.getElementById("shop");
  if (!shop) return false;
  shop.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  const search = document.getElementById("product-search");
  if (focusSearch && search) search.focus({ preventScroll: true });
  else shop.focus({ preventScroll: true });
  return true;
}

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

/**
 * Focuses the product search field on a listing page. Returns false when the page has none yet. With `retryFrames`
 * it keeps trying for that many animation frames, for a page that is still rendering after a navigation.
 */
export function focusProductSearch({ retryFrames = 0 } = {}): boolean {
  const field = document.getElementById("product-search");
  if (field) {
    field.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    field.focus({ preventScroll: true });
    return true;
  }
  if (retryFrames > 0) window.requestAnimationFrame(() => focusProductSearch({ retryFrames: retryFrames - 1 }));
  return false;
}

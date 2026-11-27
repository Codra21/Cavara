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
 * Click handler for a link to a home page section. On the home page it scrolls to the section itself and stops the
 * router: a second click on the same `/#id` is a navigation to the current location, which does not scroll again.
 * Elsewhere it does nothing, so the router opens the home page at the section.
 */
export function scrollToHomeSection(event: { preventDefault(): void }, id: string) {
  if (window.location.pathname !== "/") return;
  const section = document.getElementById(id);
  if (!section) return;
  event.preventDefault();
  // Wait two frames: the mobile menu sits in the sticky header's flow, so measuring before it closes overshoots by
  // the menu's height.
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => section.scrollIntoView({ behavior: scrollBehavior() })),
  );
}

/**
 * Inline head script. Chrome matches :focus-visible on input, textarea and select after a click, so a
 * :focus-visible ring stays up for a mouse or touch choice. pointerdown marks pointer use; Tab, Escape,
 * arrow keys, and any key pressed outside a field mark the keyboard. Typing into a field that was
 * clicked does not flip it back.
 */
export const INPUT_BOOT = `(function(){var root=document.documentElement;var mark=function(value){root.dataset.input=value;};addEventListener("pointerdown",function(){mark("pointer");},true);addEventListener("keydown",function(event){if(event.metaKey||event.ctrlKey||event.altKey||event.key==="Shift")return;var key=event.key;var moves=key==="Tab"||key==="Escape"||key.indexOf("Arrow")===0;var target=event.target;var typing=target&&target.matches&&target.matches("input, textarea, select, [contenteditable='true']");if(moves||!typing)mark("keyboard");},true);})();`;

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

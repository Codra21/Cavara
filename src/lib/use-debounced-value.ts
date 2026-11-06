import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 500;

/**
 * `value`, updated only after it has stopped changing for `delayMs`. Search boxes filter with this so typing
 * "ceramic" re-filters and re-announces the result count (aria-live) once, not seven times.
 * An empty string applies at once, so clearing a search never shows stale results.
 */
export function useDebouncedValue(value: string, delayMs = SEARCH_DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

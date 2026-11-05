import { STORAGE_KEYS } from "./config";

export type Theme = "light" | "dark";

/** Browser chrome colour per theme; matches each theme's --bg in site.css. */
export const THEME_COLORS: Record<Theme, string> = { light: "#ffffff", dark: "#101716" };

const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/** The visitor's explicit choice, or null when the site should follow the system setting. */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.theme);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

/** Runs to follow live system changes while the visitor has not chosen a theme. Returns an unsubscribe. */
export function onSystemThemeChange(listener: (theme: Theme) => void) {
  const query = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => listener(event.matches ? "dark" : "light");
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/**
 * Inline <head> script: sets data-theme and theme-color before first paint so there is no flash.
 * Same rule as above: saved choice, otherwise the system setting (Tailwind dark-mode docs, "With system theme support").
 */
export const THEME_BOOT = `(function(){try{var d=document.documentElement,s=localStorage.getItem(${JSON.stringify(
  STORAGE_KEYS.theme,
)});var t=s==="light"||s==="dark"?s:(matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light");d.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?${JSON.stringify(
  THEME_COLORS.dark,
)}:${JSON.stringify(THEME_COLORS.light)});}catch(e){}})();`;

export type ThemePreference = "light" | "dark";
export type ResolvedTheme = ThemePreference;

export const THEME_STORAGE_KEY = "theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

export function resolveTheme(
  preference: ThemePreference | "system",
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function normalizeThemePreference(
  storedPreference: unknown,
  systemPrefersDark: boolean,
): ThemePreference {
  if (isThemePreference(storedPreference)) return storedPreference;
  return resolveTheme("system", systemPrefersDark);
}

/** Runs before hydration so the saved/system theme is applied before first paint. */
export const themeBootstrapScript = `(() => {
  try {
    const stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    const preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }
})();`;

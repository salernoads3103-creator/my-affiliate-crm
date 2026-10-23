import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import {
  normalizeThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  preference: "light",
  theme: "light",
  setPreference: () => {},
  toggle: () => {},
});

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("light");
  const [hydrated, setHydrated] = useState(false);
  const theme = preference;

  useIsomorphicLayoutEffect(() => {
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let storedPreference: string | null = null;
    try {
      storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // The pre-hydration bootstrap and system preference still provide a usable theme.
    }

    const savedPreference = normalizeThemePreference(storedPreference, systemPrefersDark);
    if (storedPreference !== savedPreference) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, savedPreference);
      } catch {
        // The selected theme still applies for this page session.
      }
    }
    setPreferenceState(savedPreference);
    applyTheme(savedPreference);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) applyTheme(theme);
  }, [hydrated, theme]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      setPreferenceState(nextPreference);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
      } catch {
        // The active preference still applies for this page session.
      }
      applyTheme(nextPreference);
    },
    [],
  );

  const toggle = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [setPreference, theme]);

  return (
    <ThemeContext.Provider value={{ preference, theme, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

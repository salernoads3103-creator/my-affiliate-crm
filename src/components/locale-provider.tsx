import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  isLocale,
  LOCALE_STORAGE_KEY,
  setActiveLocale,
  type Locale,
} from "@/lib/i18n";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "uk",
  setLocale: () => {},
});

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("uk");

  const applyLocale = useCallback((next: Locale, persist: boolean) => {
    setActiveLocale(next);
    setLocaleState(next);

    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
      document.documentElement.dataset.locale = next;
      document.title = next === "uk" ? "CRMONIA — CRM для e-commerce" : "CRMONIA — E-commerce CRM";
      const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (description) {
        description.content = next === "uk"
          ? "CRM для керування лідами та продажами e-commerce команд."
          : "Manage leads and sales for e-commerce teams.";
      }
    }

    if (persist) {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // The selected language still applies for this page session.
      }
    }
  }, []);

  useIsomorphicLayoutEffect(() => {
    let saved: Locale = "uk";
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored)) saved = stored;
    } catch {
      // Ukrainian remains the default if browser storage is unavailable.
    }
    applyLocale(saved, false);
  }, [applyLocale]);

  const setLocale = useCallback((next: Locale) => applyLocale(next, true), [applyLocale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

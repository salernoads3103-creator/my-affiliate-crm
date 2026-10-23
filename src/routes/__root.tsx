import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { supabase } from "@/integrations/supabase/client";
import { t, localizeError, localeBootstrapScript } from "@/lib/i18n";
import { themeBootstrapScript } from "@/lib/theme";

function NotFoundComponent() {
  useLocale();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass rounded-3xl p-10 max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient-brand">404</h1>
        <h2 className="mt-4 text-xl font-semibold">{t("Page not found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("The page you're looking for doesn't exist.")}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-xl gradient-brand px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
        >
          {t("Go home")}
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  useLocale();
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass rounded-3xl p-10 max-w-md text-center">
        <h1 className="text-xl font-semibold">{t("Something went wrong")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{localizeError(error, t("We couldn't load the data. Please try again."))}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-xl gradient-brand px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          {t("Try again")}
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CRMONIA — CRM для e-commerce" },
      { name: "description", content: "CRM для керування лідами та продажами e-commerce команд." },
      { name: "theme-color", content: "#F8F5F0" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `${localeBootstrapScript}\n${themeBootstrapScript}` }} />
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ThemeProvider>
          <Outlet />
          <ThemeToaster />
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}

function ThemeToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={theme} />;
}

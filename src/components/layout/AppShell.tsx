import { type ReactNode, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  X,
  Sparkles,
  Command,
  Moon,
  Sun,
  Languages,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/components/theme-provider";
import { CommandPalette } from "@/components/common/CommandPalette";
import { useLocale } from "@/components/locale-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommandPalette } from "@/hooks/useCommandPalette";
import { canAccessAdministration, useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, preference, setPreference } = useTheme();
  const { locale, setLocale } = useLocale();
  const { open, setOpen } = useCommandPalette();
  const { permissions } = useWorkspaceAccess();
  const navItems = canAccessAdministration(permissions)
    ? [...NAV, { to: "/administration" as const, label: "Administration", icon: Users }]
    : NAV;

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success(t("Signed out"));
    navigate({ to: "/auth", search: { invite: undefined }, replace: true });
  };

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="px-5 py-6 flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center text-white shadow-lg shadow-primary/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">CRMONIA</div>
          <div className="text-[11px] text-muted-foreground -mt-0.5">{t("Lead Management")}</div>
        </div>
      </div>

      <button
        onClick={() => setOpen(true)}
        className="mx-4 mb-4 flex items-center justify-between gap-2 rounded-xl border border-border bg-input/40 px-3 py-2 text-sm text-muted-foreground hover:bg-input/70 transition"
      >
        <span className="flex items-center gap-2">
          <Command className="h-4 w-4" />
          {t("Quick search")}
        </span>
        <kbd className="text-[10px] rounded bg-background px-1.5 py-0.5 border">⌘K</kbd>
      </button>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "text-primary-foreground"
                  : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-xl gradient-brand shadow-lg shadow-primary/25"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{t(item.label as TranslationKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Select value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
            <SelectTrigger
              aria-label={t("Theme preference")}
              className="h-9 min-w-0 gap-1.5 rounded-xl border-border bg-input/40 px-2.5 text-xs"
            >
              {theme === "dark" ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
              <SelectValue>{theme === "dark" ? t("Dark") : t("Light")}</SelectValue>
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
              align="start"
              sideOffset={6}
              className="min-w-0 w-[var(--radix-select-trigger-width)]"
            >
              <SelectItem value="light">{t("Light theme")}</SelectItem>
              <SelectItem value="dark">{t("Dark theme")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger
              aria-label={t("Language")}
              className="h-9 min-w-0 gap-1.5 rounded-xl border-border bg-input/40 px-2.5 text-xs"
            >
              <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
              <SelectValue>{locale === "uk" ? "UA" : "EN"}</SelectValue>
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
              align="end"
              sideOffset={6}
              className="min-w-0 w-[var(--radix-select-trigger-width)]"
            >
              <SelectItem value="uk">{t("Ukrainian")}</SelectItem>
              <SelectItem value="en">{t("English")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground/80 hover:bg-destructive/10 hover:text-destructive transition"
        >
          <LogOut className="h-4 w-4" />
          {t("Sign out")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col glass border-r border-sidebar-border bg-sidebar">
        {SidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 28, stiffness: 240 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-72 z-50 glass-strong border-r border-sidebar-border bg-sidebar"
            >
              {SidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="lg:hidden sticky top-0 z-30 glass border-b border-border px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 hover:bg-muted/60 transition"
            aria-label={t("Open menu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg gradient-brand flex items-center justify-center text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold">CRMONIA</span>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 hover:bg-muted/60 transition"
            aria-label={t("Search")}
          >
            <Command className="h-5 w-5" />
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-10 max-w-[1400px] mx-auto w-full">{children}</main>
      </div>

      <CommandPalette open={open} setOpen={setOpen} onSignOut={signOut} />

      {/* Hidden close button reference for a11y purposes */}
      <span className="sr-only">
        <button onClick={() => setMobileOpen(false)}>
          <X />
        </button>
      </span>
    </div>
  );
}

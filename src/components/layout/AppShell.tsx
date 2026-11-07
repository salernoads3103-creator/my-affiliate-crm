import { type ReactNode, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  X,
  Command,
  Moon,
  Sun,
  Languages,
  Package,
  ShoppingCart,
  Building2,
  Globe2,
  Rocket,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/components/theme-provider";
import { CrmoniaWordmark } from "@/components/brand/CrmoniaWordmark";
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
import {
  hasSidebarPermission,
  isActiveSidebarRoute,
  type SidebarPermission,
} from "@/lib/navigation";
import type { ThemePreference } from "@/lib/theme";

type NavItem = {
  to:
    | "/dashboard"
    | "/leads"
    | "/orders"
    | "/launches"
    | "/products"
    | "/domains"
    | "/pixels"
    | "/administration";
  label: TranslationKey;
  icon: LucideIcon;
  permission?: SidebarPermission;
};
const NAV_GROUPS: { label: TranslationKey; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/leads", label: "Leads", icon: Users },
      { to: "/orders", label: "Orders", icon: ShoppingCart, permission: "orders.read" },
    ],
  },
  {
    label: "Launches",
    items: [
      { to: "/products", label: "Products", icon: Package, permission: "products.read" },
      { to: "/launches", label: "Launches", icon: Rocket, permission: "launches" },
      { to: "/domains", label: "Domains", icon: Globe2, permission: "landing_pages.read" },
      { to: "/pixels", label: "Pixels", icon: Radio, permission: "landing_pages.read" },
    ],
  },
  {
    label: "System",
    items: [
      {
        to: "/administration",
        label: "Administration",
        icon: Users,
        permission: "administration",
      },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, preference, setPreference } = useTheme();
  const { locale, setLocale } = useLocale();
  const { open, setOpen } = useCommandPalette();
  const { permissions, workspace, workspaces, setWorkspaceId } = useWorkspaceAccess();
  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      hasSidebarPermission(item.permission, permissions, canAccessAdministration),
    ),
  })).filter((group) => group.items.length > 0);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success(t("Signed out"));
    navigate({ to: "/auth", search: { invite: undefined }, replace: true });
  };

  const SidebarContent = (
    <div className="relative z-10 flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-6 pb-5 pt-6">
        <CrmoniaWordmark size="sidebar" showMark />
      </div>

      {workspaces.length > 1 && (
        <div className="mb-4 px-4">
          <Select
            value={workspace?.id}
            onValueChange={(workspaceId) => {
              if (workspaceId === workspace?.id) return;
              setWorkspaceId(workspaceId);
              void queryClient.cancelQueries().then(() => queryClient.clear());
            }}
          >
            <SelectTrigger
              aria-label={t("Switch workspace")}
              className="h-11 w-full min-w-0 rounded-xl border-border/80 bg-surface/75 px-3 text-sm shadow-sm"
            >
              <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <SelectValue>{workspace?.name ?? t("Select workspace")}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              {workspaces.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <button
        onClick={() => setOpen(true)}
        className="mx-4 mb-5 flex items-center justify-between gap-2 rounded-xl border border-border/75 bg-surface/55 px-3.5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <Command className="h-4 w-4" />
          {t("Quick search")}
        </span>
        <kbd className="rounded border border-border/80 bg-background/75 px-1.5 py-0.5 text-[10px]">
          ⌘K
        </kbd>
      </button>

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3.5">
        {navGroups.map((group) => (
          <section key={group.label} aria-label={t(group.label)}>
            <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/90">
              {t(group.label)}
            </h2>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const active = isActiveSidebarRoute(pathname, item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={`group relative flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[14px] font-medium transition-[background-color,border-color,color,box-shadow] duration-200 ${
                      active
                        ? "sidebar-link-active text-white"
                        : "border-transparent text-sidebar-foreground/72 hover:bg-accent/75 hover:text-foreground"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className={`relative h-[17px] w-[17px] ${active ? "text-white" : ""}`} />
                    <span className="relative">{t(item.label)}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-sidebar-border/70 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={preference}
            onValueChange={(value) => setPreference(value as ThemePreference)}
          >
            <SelectTrigger
              aria-label={t("Theme preference")}
              className="h-9 min-w-0 gap-1.5 rounded-lg border-border bg-surface/80 px-2.5 text-xs"
            >
              {theme === "dark" ? (
                <Moon className="h-4 w-4 shrink-0" />
              ) : (
                <Sun className="h-4 w-4 shrink-0" />
              )}
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
              className="h-9 min-w-0 gap-1.5 rounded-lg border-border bg-surface/80 px-2.5 text-xs"
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
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="h-4 w-4" />
          {t("Sign out")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mountain-shell flex h-dvh min-h-0 min-w-0 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="sidebar-surface hidden h-dvh max-h-dvh min-h-0 w-[20rem] shrink-0 flex-col overflow-hidden border-r border-sidebar-border lg:flex">
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
              className="sidebar-surface fixed inset-y-0 left-0 z-50 h-dvh max-h-dvh min-h-0 w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden border-r border-sidebar-border lg:hidden"
            >
              {SidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 hover:bg-muted/60 transition"
            aria-label={t("Open menu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <CrmoniaWordmark size="compact" showMark />
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 hover:bg-muted/60 transition"
            aria-label={t("Search")}
          >
            <Command className="h-5 w-5" />
          </button>
        </header>

        <main className="mx-auto min-h-0 w-full min-w-0 max-w-[1480px] flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-6 xl:p-8">
          {children}
        </main>
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

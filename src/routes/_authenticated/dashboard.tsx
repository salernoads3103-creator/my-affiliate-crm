import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { StatusBadge } from "@/components/leads/StatusBadge";
import { useLeads, useStats } from "@/hooks/useLeadsApi";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  useLocale();
  const stats = useStats();
  const leads = useLeads();
  const recent = (leads.data ?? []).slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="dashboard-page space-y-6"
    >
      <header className="dashboard-heading flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("Workspace overview")}
          </div>
          <h1 className="dashboard-title mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {t("Dashboard")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("A snapshot of your lead pipeline.")}</p>
        </div>
        <Link
          to="/leads"
          search={{ new: false }}
          className="dashboard-primary-action flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-95 active:scale-[0.99]"
        >
          {t("Manage leads")} <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <StatsCards stats={stats.data} loading={stats.isLoading} />
      <DashboardCharts stats={stats.data} />

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="dashboard-panel rounded-2xl p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">{t("Recent activity")}</h3>
          <Link
            to="/leads"
            search={{ new: false }}
            className="text-xs text-primary hover:underline"
          >
            {t("View all")}
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {recent.length === 0 && (
            <li className="py-8 text-center text-sm text-muted-foreground">
              {t("No leads yet — head to Leads to add your first one.")}
            </li>
          )}
          {recent.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-3">
              <div className="dashboard-activity-avatar flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold">
                {l.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-sm">{l.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {l.company_name ?? l.email}
                </div>
              </div>
              <StatusBadge status={l.lead_status} />
            </li>
          ))}
        </ul>
      </motion.section>
    </motion.div>
  );
}

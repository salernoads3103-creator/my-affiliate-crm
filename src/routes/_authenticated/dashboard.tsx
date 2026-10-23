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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("Workspace overview")}
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">{t("Dashboard")}</h1>
          <p className="text-sm text-muted-foreground">{t("A snapshot of your lead pipeline.")}</p>
        </div>
        <Link to="/leads" search={{ new: false }} className="rounded-xl gradient-brand text-primary-foreground text-sm font-medium px-4 py-2 flex items-center gap-2 hover:opacity-95 active:scale-[0.99] transition">
          {t("Manage leads")} <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <StatsCards stats={stats.data} loading={stats.isLoading} />
      <DashboardCharts stats={stats.data} />

      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold tracking-tight">{t("Recent activity")}</h3>
          <Link to="/leads" search={{ new: false }} className="text-xs text-primary hover:underline">{t("View all")}</Link>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {recent.length === 0 && (
            <li className="py-8 text-center text-sm text-muted-foreground">{t("No leads yet — head to Leads to add your first one.")}</li>
          )}
          {recent.map((l) => (
            <li key={l.id} className="py-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl gradient-brand text-white flex items-center justify-center font-semibold text-sm shadow-md shadow-primary/10">
                {l.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-sm">{l.name}</div>
                <div className="truncate text-xs text-muted-foreground">{l.company_name ?? l.email}</div>
              </div>
              <StatusBadge status={l.lead_status} />
            </li>
          ))}
        </ul>
      </motion.section>
    </motion.div>
  );
}

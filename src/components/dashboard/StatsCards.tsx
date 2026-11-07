import { motion } from "framer-motion";
import {
  Users,
  Sparkles,
  MessageCircle,
  CheckCircle2,
  Trophy,
  XCircle,
  TrendingUp,
} from "lucide-react";
import type { LeadStats } from "@/lib/leads/types";
import { leadStatusDashboardLabel, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

const CARDS = [
  { key: "total", label: "Total leads", icon: Users },
  { key: "New", label: "New", icon: Sparkles },
  { key: "Contacted", label: "Contacted", icon: MessageCircle },
  { key: "Qualified", label: "Qualified", icon: CheckCircle2 },
  { key: "Converted", label: "Converted", icon: Trophy },
  { key: "Lost", label: "Lost", icon: XCircle },
] as const;

export function StatsCards({ stats, loading }: { stats?: LeadStats; loading?: boolean }) {
  useLocale();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {CARDS.map((c, i) => {
        const value =
          c.key === "total"
            ? (stats?.total ?? 0)
            : (stats?.byStatus?.[c.key as keyof LeadStats["byStatus"]] ?? 0);
        const Icon = c.icon;
        return (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.4 }}
            className={`dashboard-metric relative overflow-hidden rounded-2xl p-4 ${c.key === "total" ? "dashboard-metric-primary" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {c.key === "total" ? t(c.label) : leadStatusDashboardLabel(c.key)}
              </span>
              <div
                className={`dashboard-metric-icon flex h-8 w-8 items-center justify-center rounded-lg ${c.key === "total" ? "dashboard-metric-icon-primary" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight">
              {loading ? (
                <span className="inline-block h-6 w-12 rounded bg-muted animate-pulse" />
              ) : (
                value
              )}
            </div>
            {c.key === "total" && (
              <div className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {t("all-time")}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

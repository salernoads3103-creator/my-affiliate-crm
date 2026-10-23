import { motion } from "framer-motion";
import { Users, Sparkles, MessageCircle, CheckCircle2, Trophy, XCircle, TrendingUp } from "lucide-react";
import type { LeadStats } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

const CARDS = [
  { key: "total", label: "Total leads", icon: Users, tone: "from-primary to-accent" },
  { key: "New", label: "New", icon: Sparkles, tone: "from-status-new to-status-new" },
  { key: "Contacted", label: "Contacted", icon: MessageCircle, tone: "from-status-contacted to-status-contacted" },
  { key: "Qualified", label: "Qualified", icon: CheckCircle2, tone: "from-status-qualified to-status-qualified" },
  { key: "Converted", label: "Converted", icon: Trophy, tone: "from-status-converted to-status-converted" },
  { key: "Lost", label: "Lost", icon: XCircle, tone: "from-status-lost to-status-lost" },
] as const;

export function StatsCards({ stats, loading }: { stats?: LeadStats; loading?: boolean }) {
  useLocale();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {CARDS.map((c, i) => {
        const value = c.key === "total"
          ? stats?.total ?? 0
          : stats?.byStatus?.[c.key as keyof LeadStats["byStatus"]] ?? 0;
        const Icon = c.icon;
        return (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.4 }}
            whileHover={{ y: -2 }}
            className="glass rounded-2xl p-4 relative overflow-hidden group"
          >
            <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl bg-gradient-to-br ${c.tone}`} />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t(c.label)}</span>
              <div className={`h-7 w-7 rounded-lg bg-gradient-to-br ${c.tone} text-white flex items-center justify-center shadow-md shadow-primary/10`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight">
              {loading ? <span className="inline-block h-6 w-12 rounded bg-muted animate-pulse" /> : value}
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

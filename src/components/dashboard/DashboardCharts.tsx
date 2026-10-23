import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import type { LeadStats } from "@/lib/leads/types";
import { t, translateLabel } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

const COLORS: Record<string, string> = {
  New: "var(--status-new)",
  Contacted: "var(--status-contacted)",
  Qualified: "var(--status-qualified)",
  Converted: "var(--status-converted)",
  Lost: "var(--status-lost)",
};

function formatChartDate(value: string, locale: "uk" | "en") {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short" }).format(date);
}

export function DashboardCharts({ stats }: { stats?: LeadStats }) {
  const { locale } = useLocale();
  const pie = stats
    ? Object.entries(stats.byStatus).map(([name, value]) => ({ name, value }))
    : [];
  const area = stats?.weeklyTrend ?? [];

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="glass rounded-2xl p-5 lg:col-span-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold tracking-tight">{t("New leads — last 14 days")}</h3>
            <p className="text-xs text-muted-foreground">{t("Daily inflow trend")}</p>
          </div>
        </div>
        <div className="h-64 mt-4">
          <ResponsiveContainer>
            <AreaChart data={area} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tickFormatter={(value) => formatChartDate(String(value), locale)} fontSize={11} stroke="currentColor" opacity={0.5} />
              <YAxis allowDecimals={false} fontSize={11} stroke="currentColor" opacity={0.5} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--popover)" }}
                labelStyle={{ color: "var(--popover-foreground)" }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                labelFormatter={(label) => formatChartDate(String(label), locale)}
                formatter={(value) => [value, t("Lead count")]}
              />
              <Area type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} fill="url(#gradA)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="glass rounded-2xl p-5 lg:col-span-2">
        <h3 className="font-semibold tracking-tight">{t("Status distribution")}</h3>
        <p className="text-xs text-muted-foreground">{t("Breakdown of pipeline")}</p>
        <div className="h-64 mt-4">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>
                {pie.map((d) => <Cell key={d.name} fill={COLORS[d.name]} stroke="transparent" />)}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--popover)" }}
                labelStyle={{ color: "var(--popover-foreground)" }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value, name) => [value, translateLabel(String(name))]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {pie.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[p.name] }} />
              <span className="text-muted-foreground">{translateLabel(p.name)}</span>
              <span className="ml-auto font-medium">{p.value}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

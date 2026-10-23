import { motion } from "framer-motion";
import type { LeadStatus } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

const STYLES: Record<LeadStatus, string> = {
  New: "bg-status-new/10 text-status-new-foreground ring-status-new/30",
  Contacted: "bg-status-contacted/10 text-status-contacted-foreground ring-status-contacted/30",
  Qualified: "bg-status-qualified/10 text-status-qualified-foreground ring-status-qualified/30",
  Converted: "bg-status-converted/10 text-status-converted-foreground ring-status-converted/30",
  Lost: "bg-status-lost/10 text-status-lost-foreground ring-status-lost/30",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  useLocale();
  return (
    <motion.span
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(status)}
    </motion.span>
  );
}

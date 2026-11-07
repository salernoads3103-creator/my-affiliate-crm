import type { LeadStatus } from "@/lib/leads/types";
import { leadStatusLabel } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { STATUS_BADGE_STYLES } from "@/components/leads/statusBadgeStyles";

export function StatusBadge({ status }: { status: LeadStatus }) {
  useLocale();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {leadStatusLabel(status)}
    </span>
  );
}

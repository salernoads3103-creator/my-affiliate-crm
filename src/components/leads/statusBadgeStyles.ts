import type { LeadStatus } from "@/lib/leads/types";

export const STATUS_BADGE_STYLES: Record<LeadStatus, string> = {
  New: "bg-status-new/10 text-status-new-foreground ring-status-new/30",
  Contacted: "bg-status-contacted/10 text-status-contacted-foreground ring-status-contacted/30",
  Qualified: "bg-status-qualified/10 text-status-qualified-foreground ring-status-qualified/30",
  Converted: "bg-status-converted/10 text-status-converted-foreground ring-status-converted/30",
  Lost: "bg-status-lost/10 text-status-lost-foreground ring-status-lost/30",
};

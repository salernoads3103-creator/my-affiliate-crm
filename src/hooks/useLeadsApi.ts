import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { leadService } from "@/services/leadService";
import type { LeadInput } from "@/lib/leads/types";
import { localizeError, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

export const LEAD_KEYS = {
  all: ["leads"] as const,
  list: () => [...LEAD_KEYS.all, "list"] as const,
  search: (q: string) => [...LEAD_KEYS.all, "search", q] as const,
  stats: () => [...LEAD_KEYS.all, "stats"] as const,
};

export const useLeads = () =>
  useQuery({ queryKey: LEAD_KEYS.list(), queryFn: leadService.list });

export const useSearchLeads = (q: string) =>
  useQuery({
    queryKey: LEAD_KEYS.search(q),
    queryFn: () => leadService.search(q),
    enabled: q.trim().length > 0,
  });

export const useStats = () =>
  useQuery({ queryKey: LEAD_KEYS.stats(), queryFn: leadService.stats });

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: LEAD_KEYS.all });
};

export const useCreateLead = () => {
  useLocale();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadInput) => leadService.create(input),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead created")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to create"))),
  });
};

export const useUpdateLead = () => {
  useLocale();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<LeadInput> }) =>
      leadService.update(id, input),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead updated")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to update"))),
  });
};

export const useDeleteLead = () => {
  useLocale();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => leadService.remove(id),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead deleted")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to delete"))),
  });
};

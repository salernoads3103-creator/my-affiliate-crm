import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { leadService } from "@/services/leadService";
import type { LeadInput } from "@/lib/leads/types";
import { localizeError, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";

export const LEAD_KEYS = {
  all: ["leads"] as const,
  list: (workspaceId?: string) => [...LEAD_KEYS.all, "list", workspaceId] as const,
  search: (q: string, workspaceId?: string) => [...LEAD_KEYS.all, "search", workspaceId, q] as const,
  stats: (workspaceId?: string) => [...LEAD_KEYS.all, "stats", workspaceId] as const,
};

export const useLeads = () => {
  const { workspace } = useWorkspaceAccess();
  return useQuery({
    queryKey: LEAD_KEYS.list(workspace?.id),
    queryFn: () => leadService.list(workspace!.id),
    enabled: Boolean(workspace?.id),
  });
};

export const useSearchLeads = (q: string) => {
  const { workspace } = useWorkspaceAccess();
  return useQuery({
    queryKey: LEAD_KEYS.search(q, workspace?.id),
    queryFn: () => leadService.search(q, workspace!.id),
    enabled: q.trim().length > 0 && Boolean(workspace?.id),
  });
};

export const useStats = () => {
  const { workspace } = useWorkspaceAccess();
  return useQuery({
    queryKey: LEAD_KEYS.stats(workspace?.id),
    queryFn: () => leadService.stats(workspace!.id),
    enabled: Boolean(workspace?.id),
  });
};

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: LEAD_KEYS.all });
};

export const useCreateLead = () => {
  useLocale();
  const { workspace } = useWorkspaceAccess();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadInput) => leadService.create(input, workspace?.id),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead created")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to create"))),
  });
};

export const useUpdateLead = () => {
  useLocale();
  const { workspace } = useWorkspaceAccess();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<LeadInput> }) =>
      leadService.update(id, input, workspace?.id),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead updated")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to update"))),
  });
};

export const useDeleteLead = () => {
  useLocale();
  const { workspace } = useWorkspaceAccess();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => leadService.remove(id, workspace?.id),
    onSuccess: () => { invalidate(qc); toast.success(t("Lead deleted")); },
    onError: (e) => toast.error(localizeError(e, t("Failed to delete"))),
  });
};

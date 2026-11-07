import { api } from "./api";
import type { Lead, LeadInput, LeadRemovalResult, LeadStats } from "@/lib/leads/types";

export const leadService = {
  list: (workspaceId?: string, includeDeleted = false) => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (includeDeleted) params.set("includeDeleted", "true");
    const query = params.toString();
    return api.get<Lead[]>("/api/leads" + (query ? "?" + query : ""));
  },
  search: (q: string, workspaceId?: string, includeDeleted = false) => {
    const params = new URLSearchParams({ q });
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (includeDeleted) params.set("includeDeleted", "true");
    return api.get<Lead[]>("/api/leads/search?" + params.toString());
  },
  stats: (workspaceId?: string) =>
    api.get<LeadStats>(`/api/leads/stats${workspaceQuery(workspaceId)}`),
  create: (input: LeadInput, workspaceId?: string) =>
    api.post<Lead>(`/api/leads${workspaceQuery(workspaceId)}`, input),
  update: (id: string, input: Partial<LeadInput>, workspaceId?: string) =>
    api.put<Lead>(`/api/leads/${id}${workspaceQuery(workspaceId)}`, input),
  remove: (id: string, workspaceId?: string) =>
    api.delete<{ ok: true; result: LeadRemovalResult }>(
      `/api/leads/${id}${workspaceQuery(workspaceId)}`,
    ),
  restore: (id: string, workspaceId?: string) =>
    api.post<{ ok: true }>(`/api/leads/${id}/restore${workspaceQuery(workspaceId)}`, {}),
};

function workspaceQuery(workspaceId?: string, hasQuery = false): string {
  return workspaceId ? `${hasQuery ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}` : "";
}

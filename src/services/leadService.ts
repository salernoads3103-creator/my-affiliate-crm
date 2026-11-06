import { api } from "./api";
import type { Lead, LeadInput, LeadStats } from "@/lib/leads/types";

export const leadService = {
  list: (workspaceId?: string) => api.get<Lead[]>(`/api/leads${workspaceQuery(workspaceId)}`),
  search: (q: string, workspaceId?: string) =>
    api.get<Lead[]>(`/api/leads/search?q=${encodeURIComponent(q)}${workspaceQuery(workspaceId, true)}`),
  stats: (workspaceId?: string) => api.get<LeadStats>(`/api/leads/stats${workspaceQuery(workspaceId)}`),
  create: (input: LeadInput, workspaceId?: string) =>
    api.post<Lead>(`/api/leads${workspaceQuery(workspaceId)}`, input),
  update: (id: string, input: Partial<LeadInput>, workspaceId?: string) =>
    api.put<Lead>(`/api/leads/${id}${workspaceQuery(workspaceId)}`, input),
  remove: (id: string, workspaceId?: string) =>
    api.delete<{ ok: true }>(`/api/leads/${id}${workspaceQuery(workspaceId)}`),
};

function workspaceQuery(workspaceId?: string, hasQuery = false): string {
  return workspaceId ? `${hasQuery ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}` : "";
}

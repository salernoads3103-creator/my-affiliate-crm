export type LeadStatus = "New" | "Contacted" | "Qualified" | "Converted" | "Lost";

export const LEAD_STATUSES: LeadStatus[] = ["New", "Contacted", "Qualified", "Converted", "Lost"];

export interface Lead {
  id: string;
  workspace_id: string;
  team_id: string | null;
  operator_id: string | null;
  offer_id: string | null;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  lead_status: LeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadInput {
  name: string;
  email: string;
  team_id?: string | null;
  operator_id?: string | null;
  offer_id?: string | null;
  phone?: string;
  company_name?: string;
  lead_status: LeadStatus;
  notes?: string;
}

export interface LeadStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  weeklyTrend: { date: string; count: number }[];
}

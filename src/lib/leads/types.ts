export type LeadStatus = "New" | "Contacted" | "Qualified" | "Converted" | "Lost";

export const LEAD_STATUSES: LeadStatus[] = ["New", "Contacted", "Qualified", "Converted", "Lost"];

export interface Lead {
  id: string;
  workspace_id: string;
  team_id: string | null;
  operator_id: string | null;
  offer_id: string | null;
  /** Legacy creator field retained during the API transition. */
  user_id: string | null;
  created_by_user_id: string | null;
  created_via: "manual" | "landing" | "api" | "import";
  name: string;
  email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  company_name: string | null;
  lead_status: LeadStatus;
  notes: string | null;
  traffic_source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  utm_id: string | null;
  ttclid: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  sub_id: string | null;
  delivery_provider: string | null;
  delivery_type: "warehouse" | "postomat" | "address" | null;
  delivery_city_ref: string | null;
  delivery_city_name: string | null;
  delivery_warehouse_ref: string | null;
  delivery_warehouse_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadInput {
  name: string;
  phone: string;
  email?: string | null;
  team_id?: string | null;
  operator_id?: string | null;
  offer_id?: string | null;
  company_name?: string | null;
  lead_status?: LeadStatus;
  notes?: string | null;
}

export interface LeadStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  weeklyTrend: { date: string; count: number }[];
}

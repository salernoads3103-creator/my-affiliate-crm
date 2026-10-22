import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../utils/ApiError";
import { LEAD_STATUSES, Lead, LeadInput, LeadStats, LeadStatus } from "../types/lead";

function throwLeadDatabaseError(
  error: { code?: string; message: string },
  fallbackStatus: number,
): never {
  if (error.code === "42501") {
    throw new ApiError(403, "Insufficient workspace permissions");
  }
  throw new ApiError(fallbackStatus, error.message);
}

export class LeadService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  async list(): Promise<Lead[]> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throwLeadDatabaseError(error, 500);
    return (data ?? []) as Lead[];
  }

  async search(q: string): Promise<Lead[]> {
    const term = q.trim();
    if (!term) return this.list();
    const pattern = `%${term.replace(/[%_]/g, "")}%`;
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .or(`name.ilike.${pattern},email.ilike.${pattern},company_name.ilike.${pattern}`)
      .order("created_at", { ascending: false });
    if (error) throwLeadDatabaseError(error, 500);
    return (data ?? []) as Lead[];
  }

  async create(input: LeadInput): Promise<Lead> {
    const { data, error } = await this.supabase
      .from("leads")
      .insert({ ...input, user_id: this.userId })
      .select("*")
      .single();
    if (error) throwLeadDatabaseError(error, 400);
    return data as Lead;
  }

  async update(id: string, input: Partial<LeadInput>): Promise<Lead> {
    const { data, error } = await this.supabase
      .from("leads")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throwLeadDatabaseError(error, 400);
    if (!data) throw new ApiError(404, "Lead not found");
    return data as Lead;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from("leads").delete().eq("id", id);
    if (error) throwLeadDatabaseError(error, 400);
  }

  async stats(): Promise<LeadStats> {
    const leads = await this.list();
    const byStatus = LEAD_STATUSES.reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<LeadStatus, number>,
    );
    leads.forEach((l) => {
      byStatus[l.lead_status] += 1;
    });

    const days: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = leads.filter((l) => l.created_at.slice(0, 10) === key).length;
      days.push({ date: key, count });
    }

    return { total: leads.length, byStatus, weeklyTrend: days };
  }
}

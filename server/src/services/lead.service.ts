import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../utils/ApiError";
import { LEAD_STATUSES, Lead, LeadInput, LeadStats, LeadStatus } from "../types/lead";
import { normalizeUkrainianPhone } from "../utils/lead-phone";

function throwLeadDatabaseError(error: { code?: string; message: string }): never {
  if (error.code === "42501") {
    throw new ApiError(403, "Insufficient workspace permissions");
  }
  if (error.code === "PGRST116") throw new ApiError(404, "Lead not found");
  if (error.code === "23505") throw new ApiError(409, "A lead with these details already exists");
  if (error.code === "23503") {
    throw new ApiError(
      409,
      "This lead still has related history and cannot be permanently deleted.",
    );
  }
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "")) {
    throw new ApiError(400, "Invalid lead data");
  }
  throw new ApiError(500, "The request could not be completed", "INTERNAL_ERROR", error);
}

export class LeadService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
    private workspaceId: string | null = null,
  ) {}

  async list(includeDeleted = false): Promise<Lead[]> {
    let query = this.supabase.from("leads").select("*").order("created_at", { ascending: false });
    query = includeDeleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) throwLeadDatabaseError(error);
    return (data ?? []) as Lead[];
  }

  async search(q: string, includeDeleted = false): Promise<Lead[]> {
    const term = q.trim();
    if (!term) return this.list(includeDeleted);
    const pattern = `%${term.replace(/[%_]/g, "")}%`;
    let query = this.supabase
      .from("leads")
      .select("*")
      .or(`name.ilike.${pattern},email.ilike.${pattern},company_name.ilike.${pattern}`)
      .order("created_at", { ascending: false });
    query = includeDeleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) throwLeadDatabaseError(error);
    return (data ?? []) as Lead[];
  }

  async create(input: LeadInput): Promise<Lead> {
    const { data, error } = await this.supabase
      .from("leads")
      .insert({
        ...input,
        email: input.email || null,
        user_id: this.userId,
        created_by_user_id: this.userId,
        created_via: "manual",
        phone_normalized: normalizeUkrainianPhone(input.phone),
      })
      .select("*")
      .single();
    if (error) throwLeadDatabaseError(error);
    return data as Lead;
  }

  async update(id: string, input: Partial<LeadInput>): Promise<Lead> {
    const update: Partial<LeadInput> & { phone_normalized?: string | null } = { ...input };
    if (Object.prototype.hasOwnProperty.call(input, "phone")) {
      update.phone_normalized = normalizeUkrainianPhone(input.phone);
    }
    const { data, error } = await this.supabase
      .from("leads")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throwLeadDatabaseError(error);
    if (!data) throw new ApiError(404, "Lead not found");
    return data as Lead;
  }

  async remove(id: string): Promise<"deleted" | "hidden"> {
    if (!this.workspaceId) throw new ApiError(400, "Workspace ID is required", "VALIDATION_ERROR");
    const { data, error } = await this.supabase.rpc("remove_workspace_lead", {
      p_workspace_id: this.workspaceId,
      p_lead_id: id,
    });
    if (error) throwLeadDatabaseError(error);
    if (data !== "deleted" && data !== "hidden") {
      throw new ApiError(500, "The request could not be completed", "INTERNAL_ERROR");
    }
    return data;
  }

  async restore(id: string): Promise<void> {
    if (!this.workspaceId) throw new ApiError(400, "Workspace ID is required", "VALIDATION_ERROR");
    const { error } = await this.supabase.rpc("restore_workspace_lead", {
      p_workspace_id: this.workspaceId,
      p_lead_id: id,
    });
    if (error) throwLeadDatabaseError(error);
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

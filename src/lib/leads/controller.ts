/**
 * Lead controller — validates HTTP input, delegates to LeadService, formats response.
 * Used by TanStack server routes; mirrors the controller in /server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { LeadService } from "./service";
import { LEAD_STATUSES } from "./types";

const LeadSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  email: z.string().trim().email("Invalid email").max(255),
  team_id: z.string().uuid().nullable().optional(),
  operator_id: z.string().uuid().nullable().optional(),
  offer_id: z.string().uuid().nullable().optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company_name: z.string().trim().max(120).optional().or(z.literal("")),
  lead_status: z.enum(LEAD_STATUSES as [string, ...string[]]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

const PartialLeadSchema = LeadSchema.partial();

const clean = <T extends Record<string, unknown>>(o: T) => {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) r[k] = v === "" ? null : v;
  return r;
};

export class LeadController {
  private svc: LeadService;
  constructor(supabase: SupabaseClient, userId: string) {
    this.svc = new LeadService(supabase, userId);
  }

  list = () => this.svc.list();
  stats = () => this.svc.stats();
  search = (q: string) => this.svc.search(q);

  create = async (body: unknown) => {
    const parsed = LeadSchema.parse(body);
    return this.svc.create(clean(parsed) as never);
  };

  update = async (id: string, body: unknown) => {
    if (!id) throw new Error("Missing id");
    const parsed = PartialLeadSchema.parse(body);
    return this.svc.update(id, clean(parsed) as never);
  };

  remove = async (id: string) => {
    if (!id) throw new Error("Missing id");
    await this.svc.remove(id);
    return { ok: true };
  };
}

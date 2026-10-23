/**
 * Lead controller — validates HTTP input, delegates to LeadService, formats response.
 * Used by TanStack server routes; mirrors the controller in /server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../api-error";
import { LeadService } from "./service";
import { CreateLeadSchema, UpdateLeadSchema } from "./validation";

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
    const parsed = CreateLeadSchema.parse(body);
    return this.svc.create(clean(parsed) as never);
  };

  update = async (id: string, body: unknown) => {
    if (!id) throw new ApiError(400, "Lead id is required");
    const parsed = UpdateLeadSchema.parse(body);
    return this.svc.update(id, clean(parsed) as never);
  };

  remove = async (id: string) => {
    if (!id) throw new ApiError(400, "Lead id is required");
    await this.svc.remove(id);
    return { ok: true };
  };
}

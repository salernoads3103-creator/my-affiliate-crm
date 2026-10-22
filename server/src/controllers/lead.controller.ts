import { Request, Response } from "express";
import { z } from "zod";
import { LeadService } from "../services/lead.service";
import { LEAD_STATUSES } from "../types/lead";
import { ApiError } from "../utils/ApiError";

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

function svc(req: Request) {
  if (!req.supabase || !req.userId) throw new ApiError(401, "Unauthorized");
  return new LeadService(req.supabase, req.userId);
}

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

export const LeadController = {
  list: async (req: Request, res: Response) => {
    const data = await svc(req).list();
    ok(res, data);
  },
  search: async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "");
    ok(res, await svc(req).search(q));
  },
  stats: async (req: Request, res: Response) => {
    ok(res, await svc(req).stats());
  },
  create: async (req: Request, res: Response) => {
    const parsed = LeadSchema.parse(req.body);
    const data = await svc(req).create(clean(parsed) as never);
    ok(res, data, 201);
  },
  update: async (req: Request, res: Response) => {
    const parsed = PartialLeadSchema.parse(req.body);
    const data = await svc(req).update(req.params.id, clean(parsed) as never);
    ok(res, data);
  },
  remove: async (req: Request, res: Response) => {
    await svc(req).remove(req.params.id);
    ok(res, { ok: true });
  },
};

import { z } from "zod";
import { LEAD_STATUSES } from "./types";
import { normalizeUkrainianPhone } from "./phone";

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .max(40)
  .refine((value) => normalizeUkrainianPhone(value) !== null, "Invalid phone");

const optionalPhoneSchema = z
  .union([z.string().trim().max(40), z.null()])
  .optional()
  .refine(
    (value) => value == null || value === "" || normalizeUkrainianPhone(value) !== null,
    "Invalid phone",
  );

const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().email("Invalid email").max(255).nullable().optional(),
);

const leadFields = {
  name: z.string().trim().min(1, "Name required").max(120),
  email: optionalEmailSchema,
  team_id: z.string().uuid().nullable().optional(),
  operator_id: z.string().uuid().nullable().optional(),
  offer_id: z.string().uuid().nullable().optional(),
  phone: optionalPhoneSchema,
  company_name: z.string().trim().max(120).optional().or(z.literal("")),
  lead_status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
};

export const CreateLeadSchema = z.object({
  ...leadFields,
  phone: phoneSchema,
  lead_status: z.enum(LEAD_STATUSES as [string, ...string[]]).default("New"),
});

export const UpdateLeadSchema = z.object(leadFields).partial();

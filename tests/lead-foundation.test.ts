import { describe, expect, it } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LeadController } from "../src/lib/leads/controller";
import { normalizeUkrainianPhone } from "../src/lib/leads/phone";
import { CreateLeadSchema, UpdateLeadSchema } from "../src/lib/leads/validation";
import { LeadSchema as ExpressLeadSchema } from "../server/src/controllers/lead.controller";
import { normalizeUkrainianPhone as normalizeExpressPhone } from "../server/src/utils/lead-phone";

describe("Lead Foundation input contracts", () => {
  it("normalizes common Ukrainian phone formats and rejects invalid values", () => {
    expect(normalizeUkrainianPhone("067 123 45 67")).toBe("+380671234567");
    expect(normalizeUkrainianPhone("+380 (67) 123-45-67")).toBe("+380671234567");
    expect(normalizeUkrainianPhone("12345")).toBeNull();
    expect(normalizeExpressPhone("067 123 45 67")).toBe(normalizeUkrainianPhone("067 123 45 67"));
  });

  it("accepts a short request with name and phone and defaults status", () => {
    expect(CreateLeadSchema.parse({ name: "Олена", phone: "0671234567" })).toMatchObject({
      name: "Олена",
      phone: "0671234567",
      lead_status: "New",
    });
  });

  it("requires a valid phone for new leads", () => {
    expect(() => CreateLeadSchema.parse({ name: "Олена" })).toThrow();
    expect(() => CreateLeadSchema.parse({ name: "Олена", phone: "12345" })).toThrow();
  });

  it("preserves the existing request shape with an email and explicit status", () => {
    expect(
      CreateLeadSchema.parse({
        name: "Jane Smith",
        email: "jane@example.test",
        phone: "+380671234567",
        lead_status: "Contacted",
      }),
    ).toMatchObject({ email: "jane@example.test", lead_status: "Contacted" });
  });

  it("allows partial updates and validates a supplied phone", () => {
    expect(UpdateLeadSchema.parse({ notes: "Call tomorrow" })).toEqual({ notes: "Call tomorrow" });
    expect(() => UpdateLeadSchema.parse({ phone: "not a phone" })).toThrow();
  });

  it("keeps the optional Express API compatible with short and legacy requests", () => {
    expect(ExpressLeadSchema.parse({ name: "Олена", phone: "0671234567" })).toMatchObject({
      lead_status: "New",
    });
    expect(
      ExpressLeadSchema.parse({
        name: "Jane Smith",
        email: "jane@example.test",
        phone: "+380671234567",
        lead_status: "Contacted",
      }),
    ).toMatchObject({ email: "jane@example.test", lead_status: "Contacted" });
  });
});

describe("Lead creation ownership", () => {
  it("derives author fields from the authenticated server context", async () => {
    let inserted: Record<string, unknown> = {};
    const resultBuilder = {
      insert(value: Record<string, unknown>) {
        inserted = value;
        return this;
      },
      select() {
        return this;
      },
      single: async () => ({ data: { id: "lead-id", ...inserted }, error: null }),
    };
    const supabase = {
      from: () => resultBuilder,
    } as unknown as SupabaseClient;
    const controller = new LeadController(supabase, "authenticated-user");

    await controller.create({
      name: "Short lead",
      phone: "067 123 45 67",
      workspace_id: "client-workspace",
      user_id: "client-user",
      created_by_user_id: "client-author",
      created_via: "landing",
    });

    expect(inserted).toMatchObject({
      name: "Short lead",
      email: null,
      phone_normalized: "+380671234567",
      user_id: "authenticated-user",
      created_by_user_id: "authenticated-user",
      created_via: "manual",
    });
    expect(inserted).not.toHaveProperty("workspace_id");
  });
});

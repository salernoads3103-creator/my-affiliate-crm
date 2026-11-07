import { describe, expect, it } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import { LeadService } from "../src/lib/leads/service";
import { LeadService as LegacyLeadService } from "../server/src/services/lead.service";
import { OfferService } from "../src/lib/offers/service";
import { ProductService } from "../src/lib/products/service";
import { removeTrackingProfileRecord } from "../src/lib/tracking-profiles/removal.server";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const foreignWorkspaceId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";

describe("workspace-scoped safe record removal contracts", () => {
  it("deletes an unused product through its guarded workspace RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: recordId, error: null };
      },
    } as unknown as SupabaseClient<Database>;

    await new ProductService(client).remove(workspaceId, recordId);

    expect(calls).toEqual([
      {
        name: "delete_workspace_product_if_unused",
        args: { p_workspace_id: workspaceId, p_product_id: recordId },
      },
    ]);
  });

  it("keeps a product linked to an offer or order and returns a conflict", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { code: "23503", message: "foreign key" } }),
    } as unknown as SupabaseClient<Database>;

    await expect(new ProductService(client).remove(workspaceId, recordId)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("deletes an unused offer through its guarded RPC and preserves linked history", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: null, error: { code: "23503", message: "history" } };
      },
    } as unknown as SupabaseClient<Database>;

    await expect(new OfferService(client).remove(workspaceId, recordId)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(calls).toEqual([
      {
        name: "delete_commercial_offer_if_unused",
        args: { p_workspace_id: workspaceId, p_offer_id: recordId },
      },
    ]);
  });

  it("does not treat an invalid product relation on offer save as deletion history", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { code: "23503", message: "product FK" } }),
    } as unknown as SupabaseClient<Database>;
    const service = new OfferService(client);

    await expect(
      service.create(workspaceId, {
        name: "Offer",
        productId: recordId,
        priceUah: 120000,
        landingUrl: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("soft-hides an order-linked lead through the workspace-authorized RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: "hidden", error: null };
      },
    } as unknown as SupabaseClient<Database>;

    await expect(new LeadService(client, "user-id", workspaceId).remove(recordId)).resolves.toBe(
      "hidden",
    );
    expect(calls).toEqual([
      {
        name: "remove_workspace_lead",
        args: { p_workspace_id: workspaceId, p_lead_id: recordId },
      },
    ]);
  });

  it("physically removes an unlinked lead through the same atomic RPC", async () => {
    const client = {
      rpc: async () => ({ data: "deleted", error: null }),
    } as unknown as SupabaseClient<Database>;

    await expect(new LeadService(client, "user-id", workspaceId).remove(recordId)).resolves.toBe(
      "deleted",
    );
  });

  it("restores a lead through the administrator-checked RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: recordId, error: null };
      },
    } as unknown as SupabaseClient<Database>;

    await new LeadService(client, "user-id", workspaceId).restore(recordId);
    expect(calls).toEqual([
      {
        name: "restore_workspace_lead",
        args: { p_workspace_id: workspaceId, p_lead_id: recordId },
      },
    ]);
  });

  it("uses the same soft-delete RPC in the legacy Express service", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: "hidden", error: null };
      },
    } as unknown as SupabaseClient;

    await expect(
      new LegacyLeadService(client, "user-id", workspaceId).remove(recordId),
    ).resolves.toBe("hidden");
    expect(calls).toEqual([
      {
        name: "remove_workspace_lead",
        args: { p_workspace_id: workspaceId, p_lead_id: recordId },
      },
    ]);
  });

  it("deletes only a tracking profile selected from the requested workspace", async () => {
    const filters: Array<[string, string]> = [];
    const query = {
      delete() {
        return this;
      },
      eq(column: string, value: string) {
        filters.push([column, value]);
        return this;
      },
      select() {
        return this;
      },
      maybeSingle: async () => ({ data: { id: recordId }, error: null }),
    };
    const client = { from: () => query } as unknown as SupabaseClient<Database>;

    await removeTrackingProfileRecord(client, workspaceId, recordId);

    expect(filters).toEqual([
      ["workspace_id", workspaceId],
      ["id", recordId],
    ]);
  });

  it("returns not found for a profile outside the active workspace", async () => {
    const query = {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      select() {
        return this;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const client = { from: () => query } as unknown as SupabaseClient<Database>;

    await expect(
      removeTrackingProfileRecord(client, foreignWorkspaceId, recordId),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("blocks deletion of a tracking profile referenced by a landing or launch", async () => {
    const query = {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      select() {
        return this;
      },
      maybeSingle: async () => ({ data: null, error: { code: "23503", message: "restricted FK" } }),
    };
    const client = { from: () => query } as unknown as SupabaseClient<Database>;

    await expect(removeTrackingProfileRecord(client, workspaceId, recordId)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });
});

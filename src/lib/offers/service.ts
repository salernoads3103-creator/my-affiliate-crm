import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import type { OfferCatalogResponse } from "./types";
import type { OfferInput } from "./validation";

type OfferClient = SupabaseClient<Database>;

function offerDatabaseError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Offer not found");
  }
  if (error.code === "23505") return new ApiError(409, "An offer with this name already exists");
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid offer data", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The request could not be completed", "INTERNAL_ERROR", error);
}

function offerRpcInput(workspaceId: string, input: OfferInput) {
  return {
    p_workspace_id: workspaceId,
    p_name: input.name,
    p_product_id: input.productId,
    p_offer_price_minor: input.priceUah,
    p_landing_url: input.landingUrl,
    p_is_active: input.isActive,
  };
}

export class OfferService {
  constructor(private readonly client: OfferClient) {}

  async list(workspaceId: string, search: string): Promise<OfferCatalogResponse> {
    const { data, error } = await this.client.rpc("get_workspace_offer_catalog", {
      p_workspace_id: workspaceId,
      p_search: search.trim().slice(0, 120) || null,
    });
    if (error) throw offerDatabaseError(error);
    return { offers: data ?? [] };
  }

  async create(workspaceId: string, input: OfferInput): Promise<{ id: string }> {
    const { data, error } = await this.client.rpc("create_commercial_offer", {
      ...offerRpcInput(workspaceId, input),
    });
    if (error) throw offerDatabaseError(error);
    return { id: data };
  }

  async update(workspaceId: string, offerId: string, input: OfferInput): Promise<{ id: string }> {
    const { data, error } = await this.client.rpc("update_commercial_offer", {
      ...offerRpcInput(workspaceId, input),
      p_offer_id: offerId,
    });
    if (error) throw offerDatabaseError(error);
    return { id: data };
  }
}

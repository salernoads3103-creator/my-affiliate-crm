import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import type { Order, OrderContext } from "./types";
import type { CreateOrderInput, UpdateOrderDraftInput } from "./validation";

type OrderClient = SupabaseClient<Database>;

function orderDatabaseError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Order or lead not found");
  }
  if (error.code === "23505") {
    return new ApiError(409, "The order request conflicts with an existing request");
  }
  if (error.code === "23514") {
    return new ApiError(409, "Only valid order status changes are allowed");
  }
  if (["22023", "22P02", "23502", "23503"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid order data", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The request could not be completed", "INTERNAL_ERROR", error);
}

function throwOnError<T>(result: {
  data: T | null;
  error: { code?: string; message: string } | null;
}): T | null {
  if (result.error) throw orderDatabaseError(result.error);
  return result.data;
}

export class OrderService {
  constructor(private readonly client: OrderClient) {}

  async list(workspaceId: string, search: string): Promise<Order[]> {
    let query = this.client
      .from("workspace_orders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500);
    const term = search
      .trim()
      .slice(0, 120)
      .replace(/[^\p{L}\p{N}\s@+.-]/gu, "");
    if (term) {
      const pattern = "%" + term + "%";
      query = query.or(
        "buyer_name.ilike." +
          pattern +
          ",buyer_phone.ilike." +
          pattern +
          ",product_name_snapshot.ilike." +
          pattern +
          ",offer_name_snapshot.ilike." +
          pattern,
      );
    }
    const { data, error } = await query;
    if (error) throw orderDatabaseError(error);
    return data ?? [];
  }

  async get(workspaceId: string, orderId: string): Promise<Order> {
    const { data, error } = await this.client
      .from("workspace_orders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw orderDatabaseError(error);
    if (!data) throw new ApiError(404, "Order not found");
    return data;
  }

  async getLeadContext(workspaceId: string, leadId: string): Promise<OrderContext> {
    const result = await this.client.rpc("get_workspace_order_context", {
      p_workspace_id: workspaceId,
      p_lead_id: leadId,
    });
    const data = throwOnError(result);
    if (!data?.[0]) throw new ApiError(404, "Lead not found");
    return data[0];
  }

  async create(workspaceId: string, input: CreateOrderInput): Promise<{ id: string }> {
    const result = await this.client.rpc("create_workspace_order", {
      p_workspace_id: workspaceId,
      p_lead_id: input.leadId,
      p_idempotency_key: input.idempotencyKey,
      p_quantity: input.quantity,
      p_unit_price_minor: input.unitPriceMinor,
      p_buyer_name: input.buyerName,
      p_buyer_phone: input.buyerPhone,
      p_buyer_email: input.buyerEmail,
      p_operator_comment: input.operatorComment ?? null,
    });
    const data = throwOnError(result);
    if (!data) throw new ApiError(500, "The order could not be created", "INTERNAL_ERROR");
    return { id: data };
  }

  async updateDraft(
    workspaceId: string,
    orderId: string,
    input: UpdateOrderDraftInput,
  ): Promise<{ id: string }> {
    const result = await this.client.rpc("update_workspace_order_draft", {
      p_workspace_id: workspaceId,
      p_order_id: orderId,
      p_quantity: input.quantity,
      p_unit_price_minor: input.unitPriceMinor,
      p_buyer_name: input.buyerName,
      p_buyer_phone: input.buyerPhone,
      p_buyer_email: input.buyerEmail,
      p_operator_comment: input.operatorComment ?? null,
    });
    const data = throwOnError(result);
    if (!data) throw new ApiError(500, "The order could not be updated", "INTERNAL_ERROR");
    return { id: data };
  }

  async transition(
    workspaceId: string,
    orderId: string,
    status: "draft" | "confirmed" | "cancelled",
  ): Promise<{ id: string }> {
    const result = await this.client.rpc("transition_workspace_order", {
      p_workspace_id: workspaceId,
      p_order_id: orderId,
      p_status: status,
    });
    const data = throwOnError(result);
    if (!data) throw new ApiError(500, "The order status could not be updated", "INTERNAL_ERROR");
    return { id: data };
  }
}

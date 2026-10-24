import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { OrderService } from "./service";
import { CreateOrderSchema, TransitionOrderSchema, UpdateOrderDraftSchema } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new ApiError(400, label + " is invalid", "VALIDATION_ERROR");
  return value;
}

export class OrderController {
  private readonly service: OrderService;

  constructor(client: SupabaseClient<Database>) {
    this.service = new OrderService(client);
  }

  list = (workspaceId: string, search: string) =>
    this.service.list(requireUuid(workspaceId, "Workspace id"), search);

  get = (workspaceId: string, orderId: string) =>
    this.service.get(requireUuid(workspaceId, "Workspace id"), requireUuid(orderId, "Order id"));

  getLeadContext = (workspaceId: string, leadId: string) =>
    this.service.getLeadContext(
      requireUuid(workspaceId, "Workspace id"),
      requireUuid(leadId, "Lead id"),
    );

  create = (workspaceId: string, body: unknown) =>
    this.service.create(requireUuid(workspaceId, "Workspace id"), CreateOrderSchema.parse(body));

  updateDraft = (workspaceId: string, orderId: string, body: unknown) =>
    this.service.updateDraft(
      requireUuid(workspaceId, "Workspace id"),
      requireUuid(orderId, "Order id"),
      UpdateOrderDraftSchema.parse(body),
    );

  transition = (workspaceId: string, orderId: string, body: unknown) =>
    this.service.transition(
      requireUuid(workspaceId, "Workspace id"),
      requireUuid(orderId, "Order id"),
      TransitionOrderSchema.parse(body).status,
    );
}

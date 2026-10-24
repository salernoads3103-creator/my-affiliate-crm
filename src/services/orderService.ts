import { accessApi } from "@/services/accessApi";
import type { Order, OrderContext, OrderListResponse } from "@/lib/orders/types";
import type {
  CreateOrderRequest,
  TransitionOrderInput,
  UpdateOrderDraftRequest,
} from "@/lib/orders/validation";

const basePath = (workspaceId: string) => "/api/workspaces/" + workspaceId + "/orders";

export const orderService = {
  async list(workspaceId: string, search = ""): Promise<Order[]> {
    const response = await accessApi.get<OrderListResponse>(
      basePath(workspaceId) + "?q=" + encodeURIComponent(search),
    );
    return response.orders;
  },
  get: (workspaceId: string, orderId: string) =>
    accessApi.get<Order>(basePath(workspaceId) + "/" + orderId),
  getLeadContext: (workspaceId: string, leadId: string) =>
    accessApi.get<OrderContext>(
      basePath(workspaceId) + "/context?leadId=" + encodeURIComponent(leadId),
    ),
  create: (workspaceId: string, input: CreateOrderRequest) =>
    accessApi.post<{ id: string }>(basePath(workspaceId), input),
  updateDraft: (workspaceId: string, orderId: string, input: UpdateOrderDraftRequest) =>
    accessApi.patch<{ id: string }>(basePath(workspaceId) + "/" + orderId, input),
  transition: (workspaceId: string, orderId: string, input: TransitionOrderInput) =>
    accessApi.post<{ id: string }>(basePath(workspaceId) + "/" + orderId + "/status", input),
};

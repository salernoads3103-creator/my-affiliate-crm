import { useQuery } from "@tanstack/react-query";
import { orderService } from "@/services/orderService";

export const ORDER_KEYS = {
  all: ["orders"] as const,
  list: (workspaceId: string, search: string) =>
    [...ORDER_KEYS.all, workspaceId, search.trim()] as const,
  detail: (workspaceId: string, orderId: string) =>
    [...ORDER_KEYS.all, workspaceId, "detail", orderId] as const,
  context: (workspaceId: string, leadId: string) =>
    [...ORDER_KEYS.all, workspaceId, "lead-context", leadId] as const,
};

export function useOrders(workspaceId: string | undefined, search: string) {
  return useQuery({
    queryKey: ORDER_KEYS.list(workspaceId ?? "", search),
    queryFn: () => orderService.list(workspaceId!, search),
    enabled: Boolean(workspaceId),
  });
}

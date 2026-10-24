import { accessApi } from "@/services/accessApi";
import type {
  DirectoryOption,
  NovaPoshtaDirectoryKind,
  NovaPoshtaDirectoryPurpose,
  NovaPoshtaSettings,
  NovaPoshtaSettingsInput,
  OrderDelivery,
  OrderDeliveryInput,
} from "@/lib/shipping/types";

function workspacePath(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/nova-poshta`;
}

function orderPath(workspaceId: string, orderId: string) {
  return `/api/workspaces/${workspaceId}/orders/${orderId}`;
}

export const shippingService = {
  getSettings: (workspaceId: string) =>
    accessApi.get<NovaPoshtaSettings | null>(`${workspacePath(workspaceId)}/settings`),
  saveSettings: (workspaceId: string, input: NovaPoshtaSettingsInput) =>
    accessApi.put<NovaPoshtaSettings>(`${workspacePath(workspaceId)}/settings`, input),
  searchDirectory: (
    workspaceId: string,
    kind: NovaPoshtaDirectoryKind,
    search: string,
    options: { cityRef?: string; purpose?: NovaPoshtaDirectoryPurpose; counterpartyRef?: string } = {},
  ) => {
    const query = new URLSearchParams({ kind, q: search });
    if (options.cityRef) query.set("cityRef", options.cityRef);
    if (options.purpose) query.set("purpose", options.purpose);
    if (options.counterpartyRef) query.set("counterpartyRef", options.counterpartyRef);
    return accessApi.get<DirectoryOption[]>(`${workspacePath(workspaceId)}/directories?${query}`);
  },
  getDelivery: (workspaceId: string, orderId: string) =>
    accessApi.get<OrderDelivery | null>(`${orderPath(workspaceId, orderId)}/delivery`),
  saveDelivery: (workspaceId: string, orderId: string, input: OrderDeliveryInput) =>
    accessApi.put<{ id: string }>(`${orderPath(workspaceId, orderId)}/delivery`, input),
  createWaybill: (workspaceId: string, orderId: string) =>
    accessApi.post<OrderDelivery>(`${orderPath(workspaceId, orderId)}/waybill`, {}),
  getWaybillState: (workspaceId: string, orderId: string) =>
    accessApi.get<OrderDelivery | null>(`${orderPath(workspaceId, orderId)}/waybill`),
};

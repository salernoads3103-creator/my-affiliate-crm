import { accessApi } from "@/services/accessApi";
import type { OfferCatalogResponse, OfferWriteRequest } from "@/lib/offers/types";

function basePath(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/offers`;
}

export const offerService = {
  list: (workspaceId: string, search: string) =>
    accessApi.get<OfferCatalogResponse>(
      `${basePath(workspaceId)}/catalog?q=${encodeURIComponent(search)}`,
    ),
  create: (workspaceId: string, input: OfferWriteRequest) =>
    accessApi.post<{ id: string }>(basePath(workspaceId), input),
  update: (workspaceId: string, offerId: string, input: OfferWriteRequest) =>
    accessApi.put<{ id: string }>(`${basePath(workspaceId)}/${offerId}`, input),
};

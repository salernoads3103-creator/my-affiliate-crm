import { accessApi } from "@/services/accessApi";
import type { OfferCatalogResponse, OfferWriteRequest } from "@/lib/offers/types";

export type LandingFormConfig = {
  publicId: string;
  allowedOrigin: string;
  isActive: boolean;
};

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
  getLandingForm: (workspaceId: string, offerId: string) =>
    accessApi.get<LandingFormConfig | null>(`${basePath(workspaceId)}/${offerId}/intake-form`),
  createLandingForm: (workspaceId: string, offerId: string, allowedOrigin: string) =>
    accessApi.post<LandingFormConfig>(`${basePath(workspaceId)}/${offerId}/intake-form`, {
      allowedOrigin,
    }),
  deactivateLandingForm: (workspaceId: string, offerId: string) =>
    accessApi.delete<{ deactivated: boolean }>(`${basePath(workspaceId)}/${offerId}/intake-form`),
};

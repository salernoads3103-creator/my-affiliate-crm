import type {
  LandingAdapterResponse,
  LandingListResponse,
  LandingPage,
} from "@/lib/landings/types";
import type { LandingTrackingConfiguration, TrackingProfile } from "@/lib/tracking-profiles/types";
import { accessApi } from "@/services/accessApi";

function basePath(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/landings`;
}

function itemPath(workspaceId: string, landingId: string) {
  return `${basePath(workspaceId)}/${landingId}`;
}

function adapterPath(workspaceId: string, landingId: string) {
  return `${itemPath(workspaceId, landingId)}/adapter`;
}

function toFormData(input: { name: string; offerId: string; archive?: File }): FormData {
  const formData = new FormData();
  formData.set("name", input.name);
  formData.set("offerId", input.offerId);
  if (input.archive) formData.set("archive", input.archive, input.archive.name);
  return formData;
}

export const landingService = {
  list: (workspaceId: string, search: string) =>
    accessApi.get<LandingListResponse>(`${basePath(workspaceId)}?q=${encodeURIComponent(search)}`),
  createDraft: (workspaceId: string, input: { name: string; offerId: string; archive: File }) => {
    return accessApi.postForm<LandingPage>(basePath(workspaceId), toFormData(input));
  },
  updateDraft: (
    workspaceId: string,
    landingId: string,
    input: { name: string; offerId: string; archive?: File },
  ) => accessApi.patchForm<LandingPage>(itemPath(workspaceId, landingId), toFormData(input)),
  deleteDraft: (workspaceId: string, landingId: string) =>
    accessApi.delete<{ deleted: boolean }>(itemPath(workspaceId, landingId)),
  connectForm: (
    workspaceId: string,
    landingId: string,
    input: {
      allowedOrigin?: string;
      tiktokPixelId?: string | null;
      googleAdsConversionId?: string | null;
      googleAdsConversionLabel?: string | null;
      tiktokProfileId?: string | null;
      googleAdsProfileId?: string | null;
    },
  ) =>
    accessApi.post<LandingAdapterResponse>(adapterPath(workspaceId, landingId), {
      ...input,
    }),
  downloadAdaptedArchive: (
    workspaceId: string,
    landingId: string,
    version: "current" | "previous" = "current",
  ) =>
    accessApi.getBlob(
      `${adapterPath(workspaceId, landingId)}${version === "previous" ? "?version=previous" : ""}`,
    ),
  trackingConfiguration: (workspaceId: string, landingId: string) =>
    accessApi.get<LandingTrackingConfiguration>(
      `/api/workspaces/${workspaceId}/landings/${landingId}/tracking-config`,
    ),
  trackingProfiles: async (workspaceId: string) => {
    const response = await accessApi.get<{ profiles: TrackingProfile[] }>(
      `/api/workspaces/${workspaceId}/tracking-profiles`,
    );
    return response.profiles;
  },
};

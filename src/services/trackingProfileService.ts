import { accessApi } from "@/services/accessApi";
import type {
  LandingTrackingConfiguration,
  TrackingProfile,
  TrackingProfileWriteInput,
} from "@/lib/tracking-profiles/types";

function basePath(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/tracking-profiles`;
}

export const trackingProfileService = {
  list: async (workspaceId: string) => {
    const response = await accessApi.get<{ profiles: TrackingProfile[] }>(basePath(workspaceId));
    return response.profiles;
  },
  create: (workspaceId: string, input: TrackingProfileWriteInput) =>
    accessApi.post<TrackingProfile>(basePath(workspaceId), input),
  update: (workspaceId: string, profileId: string, input: TrackingProfileWriteInput) =>
    accessApi.put<TrackingProfile>(`${basePath(workspaceId)}/${profileId}`, input),
  landingConfiguration: (workspaceId: string, landingId: string) =>
    accessApi.get<LandingTrackingConfiguration>(
      `/api/workspaces/${workspaceId}/landings/${landingId}/tracking-config`,
    ),
};

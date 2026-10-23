import type { LandingListResponse, LandingPage } from "@/lib/landings/types";
import { accessApi } from "@/services/accessApi";

function basePath(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/landings`;
}

export const landingService = {
  list: (workspaceId: string, search: string) =>
    accessApi.get<LandingListResponse>(`${basePath(workspaceId)}?q=${encodeURIComponent(search)}`),
  createDraft: (workspaceId: string, input: { name: string; offerId: string; archive: File }) => {
    const formData = new FormData();
    formData.set("name", input.name);
    formData.set("offerId", input.offerId);
    formData.set("archive", input.archive, input.archive.name);
    return accessApi.postForm<LandingPage>(basePath(workspaceId), formData);
  },
};

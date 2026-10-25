import { accessApi } from "@/services/accessApi";

export type OfferLaunchStatus = {
  launchId: string;
  offerId: string;
  offerName: string;
  stage: "offer_created" | "landing_created" | "adapter_prepared" | "published";
  lastErrorCode:
    | "LANDING_ARCHIVE_UNAVAILABLE"
    | "LANDING_ADAPTATION_REQUIRED"
    | "INTAKE_API_NOT_CONFIGURED"
    | "DOMAIN_CONFLICT"
    | "DOMAIN_NOT_READY"
    | "PUBLICATION_CONFLICT"
    | "PUBLICATION_FAILED"
    | "INTERNAL_ERROR"
    | null;
  url: string | null;
  isProcessing: boolean;
  hostId: string;
  hostname: string | null;
};

function basePath(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/offer-launches`;
}

export const offerLaunchService = {
  start: (
    workspaceId: string,
    input: {
      launchId: string;
      productId: string;
      offerName: string;
      priceUah: string;
      hostId: string;
      tiktokProfileId: string | null;
      googleAdsProfileId: string | null;
      archive: File;
    },
  ) => {
    const form = new FormData();
    form.set("launchId", input.launchId);
    form.set("productId", input.productId);
    form.set("offerName", input.offerName);
    form.set("priceUah", input.priceUah);
    form.set("hostId", input.hostId);
    form.set("tiktokProfileId", input.tiktokProfileId ?? "");
    form.set("googleAdsProfileId", input.googleAdsProfileId ?? "");
    form.set("archive", input.archive);
    return accessApi.postForm<OfferLaunchStatus>(basePath(workspaceId), form);
  },
  get: (workspaceId: string, launchId: string) =>
    accessApi.get<OfferLaunchStatus | null>(
      `${basePath(workspaceId)}/${encodeURIComponent(launchId)}`,
    ),
  resume: (workspaceId: string, launchId: string, hostId?: string) =>
    accessApi.post<OfferLaunchStatus>(`${basePath(workspaceId)}/${encodeURIComponent(launchId)}`, {
      ...(hostId ? { hostId } : {}),
    }),
};

import type { AccessClient } from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { getPublicLandingIntakeEndpoint } from "@/lib/landings/config.server";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import type { ResolvedTrackingConfig } from "@/lib/tracking-profiles/logic";
import type { LandingAdapterResponse } from "./types";
import { LandingService } from "./service";

const PENDING_ORIGIN = "https://pending.crmonia.invalid";

export type LandingAdapterSelection = {
  allowedOrigin?: string;
  tiktokPixelId?: string | null;
  googleAdsConversionId?: string | null;
  googleAdsConversionLabel?: string | null;
  tiktokProfileId?: string | null;
  googleAdsProfileId?: string | null;
  /** Trusted server-side snapshot used by durable workflows. */
  resolvedTracking?: ResolvedTrackingConfig;
};

export async function prepareLandingAdapter(
  client: AccessClient,
  workspaceId: string,
  landingId: string,
  selection: LandingAdapterSelection,
): Promise<LandingAdapterResponse> {
  const intakeEndpoint = getPublicLandingIntakeEndpoint();
  const service = new LandingService(client);
  const inspection = await service.inspectDraftAdapter(workspaceId, landingId);
  if (inspection.reason) {
    const page = await service.recordAdapterBlock(
      workspaceId,
      landingId,
      inspection.reason,
      inspection.sourceArchivePath,
    );
    return {
      adapter_status: page.adapter_status,
      adapter_reason: page.adapter_reason,
      has_adapted_archive: page.has_adapted_archive,
      adapted_archive_bytes: page.adapted_archive_bytes,
      tiktok_pixel_id: page.tiktok_pixel_id,
      google_ads_conversion_id: page.google_ads_conversion_id,
      google_ads_conversion_label: page.google_ads_conversion_label,
    };
  }

  const tracking =
    selection.resolvedTracking ??
    (await new TrackingProfileService().resolveSelection(workspaceId, selection, {
      tiktokProfileId: inspection.tiktokProfileId,
      tiktokPixelId: inspection.tiktokPixelId,
      googleAdsProfileId: inspection.googleAdsProfileId,
      googleAdsConversionId: inspection.googleAdsConversionId,
      googleAdsConversionLabel: inspection.googleAdsConversionLabel,
    }));

  const ensured = await client.rpc("ensure_landing_form_config_for_adapter", {
    p_workspace_id: workspaceId,
    p_landing_id: landingId,
  });
  if (ensured.error) throw ensured.error;
  let config = ensured.data?.[0];
  if (!config) throw new ApiError(500, "Could not prepare the landing form", "INTERNAL_ERROR");

  if (selection.allowedOrigin) {
    if (
      config.allowed_origin !== PENDING_ORIGIN &&
      config.allowed_origin !== selection.allowedOrigin
    ) {
      throw new ApiError(
        409,
        "This offer already uses a different landing origin. Use the existing origin or a separate offer.",
        "CONFLICT",
      );
    }
    const configured = await client.rpc("configure_landing_form_origin_for_adapter", {
      p_workspace_id: workspaceId,
      p_landing_id: landingId,
      p_allowed_origin: selection.allowedOrigin,
    });
    if (configured.error) throw configured.error;
    config = configured.data?.[0];
    if (!config)
      throw new ApiError(500, "Could not configure the landing origin", "INTERNAL_ERROR");
  }

  const page = await service.connectDraft({
    workspaceId,
    landingId,
    publicFormId: config.public_id,
    allowedOriginConfigured: config.is_active && config.allowed_origin !== PENDING_ORIGIN,
    allowedOrigin: config.allowed_origin,
    formActive: config.is_active,
    intakeEndpoint,
    tiktokPixelId: tracking.tiktokPixelId,
    googleAdsConversionId: tracking.googleAdsConversionId,
    googleAdsConversionLabel: tracking.googleAdsConversionLabel,
    tiktokTrackingProfileId: tracking.tiktokProfileId,
    googleAdsTrackingProfileId: tracking.googleAdsProfileId,
    tiktokProfileActive: true,
    googleAdsProfileActive: true,
  });
  return {
    adapter_status: page.adapter_status,
    adapter_reason: page.adapter_reason,
    has_adapted_archive: page.has_adapted_archive,
    adapted_archive_bytes: page.adapted_archive_bytes,
    tiktok_pixel_id: page.tiktok_pixel_id,
    google_ads_conversion_id: page.google_ads_conversion_id,
    google_ads_conversion_label: page.google_ads_conversion_label,
  };
}

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { LandingOriginSchema } from "@/lib/intake/validation";
import { getPublicLandingIntakeEndpoint } from "@/lib/landings/config.server";
import { LandingService } from "@/lib/landings/service";
import type { LandingAdapterResponse } from "@/lib/landings/types";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import { parseLandingRouteId } from "@/lib/landings/http.server";

const connectSchema = z
  .object({
    allowedOrigin: LandingOriginSchema.optional(),
    tiktokPixelId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable()
      .optional(),
    googleAdsConversionId: z
      .string()
      .trim()
      .regex(/^AW-[0-9]{1,20}$/)
      .nullable()
      .optional(),
    googleAdsConversionLabel: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .nullable()
      .optional(),
    tiktokProfileId: z.string().uuid().nullable().optional(),
    googleAdsProfileId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasId = value.googleAdsConversionId !== undefined;
    const hasLabel = value.googleAdsConversionLabel !== undefined;
    if (hasId !== hasLabel) {
      context.addIssue({ code: "custom", message: "Google Ads ID and label must be set together" });
      return;
    }
    if (hasId && Boolean(value.googleAdsConversionId) !== Boolean(value.googleAdsConversionLabel)) {
      context.addIssue({ code: "custom", message: "Google Ads ID and label must be set together" });
    }
    if (value.tiktokProfileId !== undefined && value.tiktokPixelId !== undefined) {
      context.addIssue({ code: "custom", message: "Choose either a TikTok profile or direct ID" });
    }
    if (value.googleAdsProfileId !== undefined && hasId) {
      context.addIssue({
        code: "custom",
        message: "Choose either a Google Ads profile or direct IDs",
      });
    }
  });
const PENDING_ORIGIN = "https://pending.crmonia.invalid";

function adapterResponse(page: {
  adapter_status: LandingAdapterResponse["adapter_status"];
  adapter_reason: LandingAdapterResponse["adapter_reason"];
  has_adapted_archive: boolean;
  adapted_archive_bytes: number | null;
  tiktok_pixel_id: string | null;
  google_ads_conversion_id: string | null;
  google_ads_conversion_label: string | null;
}): LandingAdapterResponse {
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

export const Route = createFileRoute("/api/workspaces/$workspaceId/landings/$landingId/adapter")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await requireWorkspacePermission(context, workspaceId, "offers.read");

          const parsed = connectSchema.safeParse(await readJsonBody(request));
          if (!parsed.success) {
            throw new ApiError(400, "Enter one exact HTTPS origin", "VALIDATION_ERROR");
          }
          const intakeEndpoint = getPublicLandingIntakeEndpoint();
          const service = new LandingService(context.client);
          const inspection = await service.inspectDraftAdapter(workspaceId, landingId);
          if (inspection.reason) {
            const page = await service.recordAdapterBlock(
              workspaceId,
              landingId,
              inspection.reason,
              inspection.sourceArchivePath,
            );
            return accessSuccessResponse(adapterResponse(page));
          }

          const tracking = await new TrackingProfileService().resolveSelection(
            workspaceId,
            parsed.data,
            {
              tiktokProfileId: inspection.tiktokProfileId,
              tiktokPixelId: inspection.tiktokPixelId,
              googleAdsProfileId: inspection.googleAdsProfileId,
              googleAdsConversionId: inspection.googleAdsConversionId,
              googleAdsConversionLabel: inspection.googleAdsConversionLabel,
            },
          );

          const ensured = await context.client.rpc("ensure_landing_form_config_for_adapter", {
            p_workspace_id: workspaceId,
            p_landing_id: landingId,
          });
          if (ensured.error) throw ensured.error;
          let config = ensured.data?.[0];
          if (!config)
            throw new ApiError(500, "Could not prepare the landing form", "INTERNAL_ERROR");

          if (parsed.data.allowedOrigin) {
            if (
              config.allowed_origin !== PENDING_ORIGIN &&
              config.allowed_origin !== parsed.data.allowedOrigin
            ) {
              throw new ApiError(
                409,
                "This offer already uses a different landing origin. Use the existing origin or a separate offer.",
                "CONFLICT",
              );
            }
            const configured = await context.client.rpc(
              "configure_landing_form_origin_for_adapter",
              {
                p_workspace_id: workspaceId,
                p_landing_id: landingId,
                p_allowed_origin: parsed.data.allowedOrigin,
              },
            );
            if (configured.error) throw configured.error;
            config = configured.data?.[0];
            if (!config) {
              throw new ApiError(500, "Could not configure the landing origin", "INTERNAL_ERROR");
            }
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
          return accessSuccessResponse(adapterResponse(page));
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const archive = await new LandingService(context.client).downloadAdaptedArchive(
            workspaceId,
            landingId,
          );
          return new Response(archive, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="landing-${landingId}-adapted.zip"`,
              "Content-Length": String(archive.size),
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});

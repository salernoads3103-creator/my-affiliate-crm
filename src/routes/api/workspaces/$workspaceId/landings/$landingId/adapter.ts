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
import { LandingService } from "@/lib/landings/service";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import { prepareLandingAdapter } from "@/lib/landings/adapter.server";

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
          const result = await prepareLandingAdapter(
            context.client,
            workspaceId,
            landingId,
            parsed.data,
          );
          return accessSuccessResponse(result);
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
          const version = new URL(request.url).searchParams.get("version");
          if (version !== null && version !== "previous") {
            throw new ApiError(400, "Unsupported adapted ZIP version", "VALIDATION_ERROR");
          }
          const service = new LandingService(context.client);
          const archive =
            version === "previous"
              ? await service.downloadPreviousAdaptedArchive(workspaceId, landingId)
              : await service.downloadAdaptedArchive(workspaceId, landingId);
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

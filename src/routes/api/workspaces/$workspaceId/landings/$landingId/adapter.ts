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
import { parseLandingRouteId } from "@/lib/landings/http.server";

const connectSchema = z.object({ allowedOrigin: LandingOriginSchema.optional() }).strict();
const PENDING_ORIGIN = "https://pending.crmonia.invalid";

function adapterResponse(page: {
  adapter_status: LandingAdapterResponse["adapter_status"];
  adapter_reason: LandingAdapterResponse["adapter_reason"];
  has_adapted_archive: boolean;
  adapted_archive_bytes: number | null;
}): LandingAdapterResponse {
  return {
    adapter_status: page.adapter_status,
    adapter_reason: page.adapter_reason,
    has_adapted_archive: page.has_adapted_archive,
    adapted_archive_bytes: page.adapted_archive_bytes,
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
            intakeEndpoint,
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

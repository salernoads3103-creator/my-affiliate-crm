import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import {
  analyzeUploadedLandingArchive,
  parseLandingRouteId,
  parseLandingUpdateForm,
  readLandingForm,
} from "@/lib/landings/http.server";
import { LandingService } from "@/lib/landings/service";

export const Route = createFileRoute("/api/workspaces/$workspaceId/landings/$landingId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await requireWorkspacePermission(context, workspaceId, "offers.read");

          const fields = parseLandingUpdateForm(await readLandingForm(request));
          const analysis = fields.archive
            ? await analyzeUploadedLandingArchive(fields.archive)
            : undefined;
          const data = await new LandingService(context.client).updateDraft({
            name: fields.name,
            offerId: fields.offerId,
            workspaceId,
            landingId,
            ...(fields.archive ? { archive: fields.archive, analysis } : {}),
          });
          return accessSuccessResponse(data);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await new LandingService(context.client).deleteDraft({ workspaceId, landingId });
          return accessSuccessResponse({ deleted: true });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});

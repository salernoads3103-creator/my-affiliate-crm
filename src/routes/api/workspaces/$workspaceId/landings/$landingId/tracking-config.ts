import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import { LandingService } from "@/lib/landings/service";
import { parseLandingRouteId } from "@/lib/landings/http.server";

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/landings/$landingId/tracking-config",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const selection = await new TrackingProfileService().landingConfiguration(
            workspaceId,
            landingId,
          );
          const configuration = await new LandingService(context.client).preparationReadiness(
            workspaceId,
            landingId,
            selection,
          );
          return accessSuccessResponse(configuration);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});

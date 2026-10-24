import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
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
          const configuration = await new TrackingProfileService().landingConfiguration(
            workspaceId,
            landingId,
          );
          return accessSuccessResponse(configuration);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});

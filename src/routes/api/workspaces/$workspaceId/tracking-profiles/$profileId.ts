import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import { TrackingProfileWriteSchema } from "@/lib/tracking-profiles/validation";

export const Route = createFileRoute("/api/workspaces/$workspaceId/tracking-profiles/$profileId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const profileId = parseLandingRouteId(params.profileId, "tracking profile");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const parsed = TrackingProfileWriteSchema.safeParse(await readJsonBody(request));
          if (!parsed.success) {
            throw new ApiError(400, "Enter valid tracking profile details", "VALIDATION_ERROR");
          }
          const profile = await new TrackingProfileService().update(
            workspaceId,
            profileId,
            context.user.id,
            parsed.data,
          );
          return accessSuccessResponse(profile);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
